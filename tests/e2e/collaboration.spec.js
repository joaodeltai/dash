/* Two people in one workspace, each in their own browser: invitation, live notifications and comments, permissions the database enforces,
   private projects, concurrent edits, and what happens when someone deletes a task or removes a member. The tests run in order and build on each other. */
import {
  DELETE_HOLD_MS,
  REALTIME_TIMEOUT,
  count,
  createTaskViaModal,
  createUser,
  dayOfThisMonth,
  expect,
  expectDb,
  goto,
  lit,
  newPersonPage,
  onboard,
  openAs,
  openProjectTab,
  pickOption,
  skipUnlessReady,
  sql,
  test,
  trackErrors,
  uniqueName,
  waitIdle,
  workspaceIds,
} from './helpers.js';

test.describe.configure({ mode: 'serial' });

let alice; // owner, drives the first browser
let bruno; // invited member, second browser
let A; // { context, page, errors }
let B;
let ids;
let brunoMember;
let sharedTask;

test.beforeAll(async ({ browser }) => {
  skipUnlessReady();
  alice = await createUser({ name: 'Alice Owner', tag: 'alice' });
  bruno = await createUser({ name: 'Bruno Member', tag: 'bruno' });
  const context = await browser.newContext();
  const page = await context.newPage();
  A = { context, page, errors: trackErrors(page) };
  await openAs(page, alice);
  await onboard(page, { workspace: uniqueName('Shared Space'), project: 'Shared project' });
  ids = await workspaceIds(alice);
});
test.afterAll(async () => {
  if (!A) return; // skipped
  expect(A.errors, 'uncaught errors (Alice)').toEqual([]);
  expect(B?.errors ?? [], 'uncaught errors (Bruno)').toEqual([]);
  await A.context.close();
  await B?.context.close();
});

const card = (page, id) => page.locator(`.kcard[data-id="${id}"]`);

test('inviting a person by e-mail creates a pending member; on first sign-in they land in the workspace and the owner sees them join live', async ({
  browser,
}) => {
  const { page } = A;
  await goto(page, 'members');
  await page.locator('[data-a="invite"]').first().click();
  await page.locator('#inv-emails').fill('not-an-email');
  await page.locator('#inv-submit').click();
  await expect(page.locator('.modal .err')).toContainText("isn't a valid email");
  await page.locator('#inv-emails').fill(bruno.email);
  await page.locator('#inv-submit').click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await expectDb(`select status||':'||coalesce(user_id::text,'null')||':'||role from public.members where email = ${lit(bruno.email)}`, 'invited:null:member');
  await expect(page.locator('tr[data-ctx="member"]', { hasText: bruno.email })).toBeVisible();

  B = await newPersonPage(browser, bruno);
  await expect(B.page.locator('.shell')).toBeVisible(); // no onboarding: the invitation was claimed
  await expect(B.page.locator('.ws-name')).toContainText('Shared Space');
  await expectDb(`select status from public.members where email = ${lit(bruno.email)}`, 'active');
  brunoMember = sql(`select id from public.members where email = ${lit(bruno.email)}`);

  // the owner's open Members page updates without a reload
  const row = page.locator('tr[data-ctx="member"]', { hasText: bruno.email });
  await expect(row.locator('.badge.green')).toHaveText('Active', { timeout: REALTIME_TIMEOUT });
  await expect(row.locator('.badge.amber')).toHaveCount(0);
  // Bruno stays on Home here: opening a project would hit the defect described in the last test of this file
  await expect(B.page.locator('nav.side [data-a="go"][data-r="project"]', { hasText: 'Shared project' })).toBeVisible();
  expect(await B.page.evaluate(() => window.__gr8r.D().tasks.length), 'the project data came with the workspace').toBe(6);
});

test('an assignment notifies the assignee live (and not the person who assigned)', async () => {
  const { page } = A;
  await openProjectTab(page, ids.project, 'board');
  sharedTask = await createTaskViaModal(page, uniqueName('Assigned to Bruno'));
  await goto(B.page, 'inbox');

  await card(page, sharedTask).locator('[data-pop="assignee"]').click();
  await page.locator(`.pop .mi[data-v="${brunoMember}"]`).click();
  await expectDb(`select assignee_id from public.tasks where id = ${lit(sharedTask)}`, brunoMember);

  const note = B.page.locator('[data-a="selNotif"]', { hasText: 'assigned you' });
  await expect(note).toHaveCount(1, { timeout: REALTIME_TIMEOUT });
  await expect(note).toContainText('Assigned to Bruno');
  expect(count(`select 1 from public.notifications where recipient_id = ${lit(ids.member)}`), 'the person who assigned gets nothing').toBe(0);
});

test('a mention in a comment notifies the mentioned person live and the comment shows up in their open task', async () => {
  await A.page.goto(`/#/task/${sharedTask}`);
  await expect(A.page.locator('.drawer')).toBeVisible();
  await B.page.goto(`/#/task/${sharedTask}`);
  const drawerB = B.page.locator('.drawer');
  await expect(drawerB).toBeVisible();

  await drawerB.locator('#d-cmt').pressSequentially('Looks good @Ali');
  await B.page.locator('.pop .mi[data-a="pickMention"]', { hasText: 'Alice Owner' }).click();
  await drawerB.locator('[data-a="postComment"]').click();
  await expect(drawerB.locator('.cmt')).toContainText('Looks good @Alice Owner');

  await expect(A.page.locator('.drawer .cmt')).toContainText('Looks good @Alice Owner', { timeout: REALTIME_TIMEOUT });
  await expectDb(`select count(*) from public.notifications where recipient_id = ${lit(ids.member)} and type = 'mention'`, 1);
  await A.page.locator('.drawer [data-a="closeDrawer"]').click();
  await goto(A.page, 'inbox');
  await expect(A.page.locator('[data-a="selNotif"]', { hasText: 'mentioned you' })).toHaveCount(1);
  await B.page.locator('.drawer [data-a="closeDrawer"]').click();
});

test('a member cannot promote themselves: the database refuses and the screen rolls back with a message', async () => {
  const { page } = B;
  await page.evaluate(async () => {
    const { D } = window.__gr8r;
    const { mutate } = await import('/src/ui/toast.js');
    mutate(() => {
      D().members.find(m => m.id === D().me).role = 'Admin';
    });
  });
  await expect(page.locator('#toasts .toast')).toBeVisible({ timeout: REALTIME_TIMEOUT });
  await expect.poll(() => page.evaluate(() => window.__gr8r.D().members.find(m => m.id === window.__gr8r.D().me).role)).toBe('Member');
  await expectDb(`select role from public.members where id = ${lit(brunoMember)}`, 'member');
});

test('a private project is invisible to a member who is not in it', async () => {
  const { page } = A;
  await page.locator('nav.side [data-a="newProject"]').click();
  await page.locator('#p-name').fill('Secret plan');
  await page.locator('.modal [data-a="submitProject"]').click();
  await expect(page.locator('.proj-h h1')).toHaveText('Secret plan');
  await expectDb(`select count(*) from public.projects where name = 'Secret plan' and workspace_id = ${lit(ids.ws)}`, 1);
  const secret = sql(`select id from public.projects where name = 'Secret plan' and workspace_id = ${lit(ids.ws)}`);
  await page.locator('.proj-h .tab[data-tab="board"]').click();
  await createTaskViaModal(page, uniqueName('Hidden task'));

  await page.locator('.proj-h [data-a="share"]').last().click();
  await pickOption(page, page.locator('.modal button.select-btn[aria-label="General access"]'), 'Only');
  await expectDb(`select is_private from public.projects where id = ${lit(secret)}`, 't');
  await page.locator('.modal [data-a="closeModal"]').last().click();
  await waitIdle(page);

  await B.page.reload();
  await expect(B.page.locator('.shell')).toBeVisible();
  await expect(B.page.locator('nav.side [data-a="go"][data-r="project"]').first()).toBeVisible();
  await expect(B.page.locator(`nav.side [data-a="go"][data-r="project"][data-id="${secret}"]`)).toHaveCount(0);
  await expect(B.page.locator('nav.side')).not.toContainText('Secret plan');
  await B.page.goto(`/#/project/${secret}/board`);
  await expect(B.page.locator('.crumbs .cur')).toHaveText('Home'); // the link falls back to the start page
  await expect(B.page.locator('.proj-h')).toHaveCount(0);
  expect(await B.page.evaluate(() => window.__gr8r.D().tasks.some(t => t.title.startsWith('Hidden task'))), 'none of its data was sent to Bruno').toBe(false);
});

test('two people editing different fields of the same task do not overwrite each other, and both screens converge', async () => {
  const due = dayOfThisMonth(20);
  for (const who of [A, B]) {
    await who.page.goto(`/#/task/${sharedTask}`);
    await expect(who.page.locator('.drawer')).toBeVisible();
  }
  const edits = [
    async () => {
      await A.page.locator('.drawer [data-pop="priority"]').click();
      await A.page.locator('.pop .mi[data-v="urgent"]').click();
    },
    async () => {
      await B.page.locator('.drawer [data-pop="date"][data-field="due"]').click();
      await B.page.locator(`.pop [data-a="popPick"][data-v="${due}"]`).click();
    },
  ];
  await Promise.all(edits.map(edit => edit()));
  await expectDb(`select priority||'|'||due_date from public.tasks where id = ${lit(sharedTask)}`, `urgent|${due}`, { timeout: REALTIME_TIMEOUT });
  for (const who of [A, B]) {
    await expect(who.page.locator('.drawer [data-pop="priority"]')).toContainText('Urgent', { timeout: REALTIME_TIMEOUT });
    await expect(who.page.locator('.drawer [data-pop="date"][data-field="due"]')).not.toContainText('Set date', { timeout: REALTIME_TIMEOUT });
    await who.page.locator('.drawer [data-a="closeDrawer"]').click();
  }
});

test('a task deleted by one person disappears from the other person’s board live', async () => {
  const victim = await createTaskViaModal((await openProjectTab(A.page, ids.project, 'board'), A.page), uniqueName('Doomed'));
  await openProjectTab(B.page, ids.project, 'board');
  await expect(card(B.page, victim)).toBeVisible({ timeout: REALTIME_TIMEOUT });

  await card(A.page, victim).click({ button: 'right' });
  await A.page.locator('.pop [data-a="delTask"]').click();
  await A.page.locator('.modal [data-a="confirmOk"]').click();
  await expect(card(A.page, victim)).toHaveCount(0);
  await expect(card(B.page, victim), 'still there while the undo window is open').toBeVisible();
  await expectDb(`select count(*) from public.tasks where id = ${lit(victim)}`, 0, { timeout: DELETE_HOLD_MS + 10_000 });
  await expect(card(B.page, victim)).toHaveCount(0, { timeout: REALTIME_TIMEOUT });
});

test('removing a member who wrote comments keeps the comments, clears their authorship and takes them out of the workspace', async () => {
  const { page } = A;
  expect(count(`select 1 from public.comments where author_id = ${lit(brunoMember)}`)).toBeGreaterThan(0);
  await goto(page, 'members');
  await page.locator(`tr[data-ctx="member"][data-id="${brunoMember}"]`).click({ button: 'right' });
  await page.locator('.pop [data-a="removeMember"]').click();
  await page.locator('.modal [data-a="confirmOk"]').click();
  await expect(page.locator(`tr[data-ctx="member"][data-id="${brunoMember}"]`)).toHaveCount(0);
  await expectDb(`select count(*) from public.members where id = ${lit(brunoMember)}`, 0, { timeout: DELETE_HOLD_MS + 10_000 });
  expect(count(`select 1 from public.comments where body like 'Looks good%' and author_id is null`), 'the comment stays, with no author').toBe(1);

  await expect(page.locator('tr[data-ctx="member"]')).toHaveCount(1); // only Alice is left, and her screen is not broken
  await expect(page.locator('main')).not.toContainText('Something went wrong');
  await page.locator('nav.side [data-a="go"][data-r="project"]').first().click();
  await expect(page.locator('.proj-h h1')).toBeVisible();

  // the removed person is taken out of the workspace without reloading
  await expect(B.page.locator('.auth-card.onb')).toBeVisible({ timeout: REALTIME_TIMEOUT });
  await expect(B.page.locator('.shell')).toHaveCount(0);
});

/* Regression test: the first visit to a project view creates default view settings while rendering, without any action calling save().
   That used to leave a change pending forever, which postponed every realtime refresh until the person made an edit of their own. */
test.describe('live updates after opening a project', () => {
  test.describe.configure({ mode: 'serial' });
  let owner;
  let guest;
  let O;
  let G;
  let project;

  test.beforeAll(async ({ browser }) => {
    skipUnlessReady();
    owner = await createUser({ name: 'Olga Owner', tag: 'olga' });
    guest = await createUser({ name: 'Gil Member', tag: 'gil' });
    const context = await browser.newContext();
    const page = await context.newPage();
    O = { context, page, errors: trackErrors(page) };
    await openAs(page, owner);
    await onboard(page, { workspace: uniqueName('Live Space'), project: 'Live project', invites: [guest.email] });
    project = (await workspaceIds(owner)).project;
    G = await newPersonPage(browser, guest);
    await expect(G.page.locator('.ws-name')).toContainText('Live Space');
  });
  test.afterAll(async () => {
    await O?.context.close();
    await G?.context.close();
  });

  test('a task created by someone else shows up on the board of a person who just opened the project', async () => {
    await openProjectTab(G.page, project, 'board');
    await openProjectTab(O.page, project, 'board');
    const title = uniqueName('Created while you watch');
    const id = await createTaskViaModal(O.page, title);
    await expect(G.page.locator(`.kcard[data-id="${id}"]`)).toBeVisible({ timeout: REALTIME_TIMEOUT });
  });
});
