/* Tasks: create, edit, comment, subtasks, favourites, delete with the undo window, and where the address bar and the history take you. */
import {
  DELETE_HOLD_MS,
  count,
  createTaskViaModal,
  createUser,
  dismissToasts,
  expect,
  expectDb,
  goto,
  lit,
  onboard,
  openAs,
  openProjectTab,
  openWorkspace,
  skipUnlessReady,
  sql,
  test,
  toast,
  uniqueName,
  waitIdle,
  workspaceIds,
} from './helpers.js';

let owner;
let ids;

test.beforeAll(async ({ browser }) => {
  skipUnlessReady();
  const context = await browser.newContext();
  const page = await context.newPage();
  owner = await createUser({ name: 'Tasks Owner', tag: 'tasks' });
  await openAs(page, owner);
  await onboard(page, { workspace: uniqueName('Tasks Space'), project: 'Tasks project' });
  ids = await workspaceIds(owner);
  await context.close();
});

test.beforeEach(async ({ page }) => {
  await openWorkspace(page, owner, `#/project/${ids.project}/board`);
});

const card = (page, id) => page.locator(`.kcard[data-id="${id}"]`);
const taskRow = id => `select title||'|'||status||'|'||priority||'|'||coalesce(due_date::text,'') from public.tasks where id = ${lit(id)}`;

test('onboarding leaves the project open on its board, with the template tasks saved', async ({ page }) => {
  await expect(page).toHaveURL(new RegExp(`#/project/${ids.project}/board$`));
  await expect(page.locator('.proj-h h1')).toHaveText('Tasks project');
  expect(count(`select 1 from public.tasks where project_id = ${lit(ids.project)}`)).toBe(6);
  await expect(page.locator('.kcard')).toHaveCount(6);
});

test('creating a task through the modal saves it and shows it on the board', async ({ page }) => {
  const title = uniqueName('Write the brief');
  await page.locator('.pbody [data-a="newTask"]').first().click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await modal.locator('#f-submit').click();
  await expect(modal.locator('#f-title-err')).toBeVisible(); // a title is required
  await modal.locator('#f-title').fill(title);
  await modal.locator('#f-desc').fill('Plain description');
  await modal.locator('#f-sub').fill('First step');
  await page.keyboard.press('Enter');
  await modal.locator('[data-pop="priority"]').click();
  await page.locator('.pop .mi[data-v="high"]').click();
  await modal.locator('#f-submit').click();
  await expect(modal).toHaveCount(0);

  await expectDb(`select count(*) from public.tasks where title = ${lit(title)}`, 1);
  const id = sql(`select id from public.tasks where title = ${lit(title)}`);
  await expectDb(`select status||'|'||priority||'|'||coalesce(description,'') from public.tasks where id = ${lit(id)}`, 'todo|high|<p>Plain description</p>');
  await expectDb(`select string_agg(title, ',') from public.subtasks where task_id = ${lit(id)}`, 'First step');
  await expect(card(page, id)).toContainText(title);
  expect(sql(`select key from public.tasks where id = ${lit(id)}`)).toMatch(/^[A-Z]+-\d+$/);
});

test('editing a task in the drawer saves each field', async ({ page }) => {
  const title = uniqueName('Edit me');
  const id = await createTaskViaModal(page, title);
  await card(page, id).click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible();

  const renamed = title + ' (renamed)';
  await drawer.locator('#d-title').fill(renamed);
  await drawer.locator('#d-title').blur();
  await drawer.locator('[data-pop="status"]').click();
  await page.locator('.pop .mi[data-v="progress"]').click();
  await drawer.locator('[data-pop="priority"]').click();
  await page.locator('.pop .mi[data-v="urgent"]').click();
  const now = new Date();
  const due = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  await drawer.locator('[data-pop="date"][data-field="due"]').click();
  await page.locator(`.pop [data-a="popPick"][data-v="${due}"]`).click();
  await expectDb(taskRow(id), `${renamed}|progress|urgent|${due}`);

  // description: a rich text field
  await drawer.locator('#d-desc').click();
  await page.keyboard.type('Described from the drawer');
  await drawer.locator('#d-title').click(); // blur saves
  await expect.poll(() => sql(`select description from public.tasks where id = ${lit(id)}`)).toContain('Described from the drawer');
  await expect(drawer.locator('.pillbtn[data-pop="status"]')).toContainText('In Progress');
});

test('comments are posted from the drawer and persisted', async ({ page }) => {
  const id = await createTaskViaModal(page, uniqueName('Discuss'));
  await card(page, id).click();
  const drawer = page.locator('.drawer');
  const text = uniqueName('First comment');
  await drawer.locator('#d-cmt').fill(text);
  await drawer.locator('[data-a="postComment"]').click();
  await expect(drawer.locator('.cmt')).toContainText(text);
  await expectDb(`select count(*) from public.comments where task_id = ${lit(id)} and body = ${lit(text)}`, 1);
  // and it can be removed again
  await drawer.locator('[data-a="delComment"]').click();
  await expect(drawer.locator('.cmt')).toHaveCount(0);
  await expectDb(`select count(*) from public.comments where task_id = ${lit(id)}`, 0);
});

test('subtasks keep their order and done state, and the favourite is personal', async ({ page }) => {
  const id = await createTaskViaModal(page, uniqueName('With parts'));
  await card(page, id).click();
  const drawer = page.locator('.drawer');
  for (const s of ['Sub one', 'Sub two']) {
    await drawer.locator('#d-sub').fill(s);
    await drawer.locator('#d-sub').press('Enter');
    await expect(drawer.locator('.subt', { hasText: s })).toBeVisible();
  }
  await drawer.locator('.subt', { hasText: 'Sub two' }).locator('input.check').check();
  await expectDb(
    `select string_agg(title||':'||done||':'||position, ',' order by position) from public.subtasks where task_id = ${lit(id)}`,
    'Sub one:false:0,Sub two:true:1',
  );

  await drawer.locator('[data-a="toggleFavTask"]').click();
  await expectDb(`select count(*) from public.task_favorites where task_id = ${lit(id)}`, 1);
  await drawer.locator('[data-a="toggleFavTask"]').click();
  await expectDb(`select count(*) from public.task_favorites where task_id = ${lit(id)}`, 0);
});

test('deleting waits out the undo window; Undo cancels it, otherwise the task goes with its children', async ({ page }) => {
  const title = uniqueName('Short lived');
  const id = await createTaskViaModal(page, title);
  await card(page, id).click();
  const drawer = page.locator('.drawer');
  await drawer.locator('#d-sub').fill('A subtask');
  await drawer.locator('#d-sub').press('Enter');
  await drawer.locator('#d-cmt').fill('A comment');
  await drawer.locator('[data-a="postComment"]').click();
  await expectDb(
    `select (select count(*) from public.subtasks where task_id = ${lit(id)}) + (select count(*) from public.comments where task_id = ${lit(id)})`,
    2,
  );
  await drawer.locator('[data-a="closeDrawer"]').click();

  const remove = async () => {
    await card(page, id).click({ button: 'right' });
    await page.locator('.pop [data-a="delTask"]').click();
    await page.locator('.modal [data-a="confirmOk"]').click();
    await expect(card(page, id)).toHaveCount(0);
  };

  // 1. undo
  await remove();
  expect(count(`select 1 from public.tasks where id = ${lit(id)}`), 'held while the undo window is open').toBe(1);
  await toast(page).locator('.ta', { hasText: 'Undo' }).click();
  await expect(card(page, id)).toHaveCount(1);
  await page.waitForTimeout(DELETE_HOLD_MS + 2000); // the product's own window: nothing may reach the database after an undo
  expect(count(`select 1 from public.tasks where id = ${lit(id)}`)).toBe(1);
  expect(count(`select 1 from public.comments where task_id = ${lit(id)}`)).toBe(1);
  await dismissToasts(page);

  // 2. let it go
  await remove();
  await expectDb(`select count(*) from public.tasks where id = ${lit(id)}`, 0, { timeout: DELETE_HOLD_MS + 10_000 });
  expect(count(`select 1 from public.subtasks where task_id = ${lit(id)}`)).toBe(0);
  expect(count(`select 1 from public.comments where task_id = ${lit(id)}`)).toBe(0);
});

test('the address bar mirrors the page: reload keeps the place and Back returns to the project', async ({ page }) => {
  await goto(page, 'inbox');
  await expect(page).toHaveURL(/#\/inbox$/);
  await page.reload();
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page).toHaveURL(/#\/inbox$/);
  await expect(page.locator('.crumbs .cur')).toHaveText('Inbox');
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#/project/${ids.project}/board$`));
  await expect(page.locator('.proj-h h1')).toHaveText('Tasks project');
  await openProjectTab(page, ids.project, 'list');
  await expect(page).toHaveURL(new RegExp(`#/project/${ids.project}/list$`));
  await waitIdle(page);
});
