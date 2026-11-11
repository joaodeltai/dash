/* Planning: calendar events (create, edit, delete) and project milestones on the overview and the timeline. */
import {
  DELETE_HOLD_MS,
  count,
  createUser,
  dayOfThisMonth,
  expect,
  expectDb,
  lit,
  onboard,
  openAs,
  openProjectTab,
  openWorkspace,
  pickOption,
  query,
  skipUnlessReady,
  test,
  toast,
  uniqueName,
  workspaceIds,
} from './helpers.js';

let owner;
let ids;

test.beforeAll(async ({ browser }) => {
  skipUnlessReady();
  const context = await browser.newContext();
  const page = await context.newPage();
  owner = await createUser({ name: 'Plan Owner', tag: 'plan' });
  await openAs(page, owner);
  await onboard(page, { workspace: uniqueName('Plan Space'), project: 'Plan project' });
  ids = await workspaceIds(owner);
  await context.close();
});

const eventRow = title =>
  query(`select id, event_date::text date, event_time time, project_id from public.events where workspace_id = ${lit(ids.ws)} and title = ${lit(title)}`);
const chip = (page, title) => page.locator('.cev.event', { hasText: title });

test('an event can be created, edited and deleted from the workspace calendar', async ({ page }) => {
  await openWorkspace(page, owner, '#/calendar');
  await expect(page.locator('.crumbs .cur')).toHaveText('Calendar');
  const title = uniqueName('Design review');
  const day = dayOfThisMonth(18);

  // create: a title and a valid date are required
  await page.locator('button[aria-label="New event"]').click();
  const modal = page.locator('.modal');
  await modal.locator('#ev-submit').click();
  await expect(modal.locator('.err').first()).toContainText('Give the event a title');
  await modal.locator('#ev-title').fill(title);
  await modal.locator('#ev-date').fill(day);
  await modal.locator('#ev-time').fill('09:30');
  await pickOption(page, modal.locator('button.select-btn[data-for="ev-project"]'), 'Plan project');
  await modal.locator('#ev-submit').click();
  await expect(modal).toHaveCount(0);
  await expect(chip(page, title)).toBeVisible();
  await expectDb(`select count(*) from public.events where title = ${lit(title)} and workspace_id = ${lit(ids.ws)}`, 1);
  const created = eventRow(title)[0];
  expect(created).toMatchObject({ date: day, time: '09:30', project_id: ids.project });

  // reload: it is still there
  await page.reload();
  await expect(chip(page, title)).toBeVisible();

  // edit
  const renamed = title + ' (moved)';
  await chip(page, title).click();
  await page.locator('.pop [data-a="editEvent"]').click();
  await modal.locator('#ev-title').fill(renamed);
  await modal.locator('#ev-time').fill('14:00');
  await modal.locator('#ev-submit').click();
  await expect(modal).toHaveCount(0);
  await expect(chip(page, renamed)).toBeVisible();
  await expectDb(`select title||'|'||event_time from public.events where id = ${lit(created.id)}`, `${renamed}|14:00`);
  expect(count(`select 1 from public.events where workspace_id = ${lit(ids.ws)} and title = ${lit(title)}`), 'edited in place, not duplicated').toBe(0);

  // delete: gone from the screen at once, from the database after the undo window
  await chip(page, renamed).click();
  await page.locator('.pop [data-a="delEvent"]').click();
  await expect(chip(page, renamed)).toHaveCount(0);
  await expect(toast(page).filter({ hasText: 'Deleted' })).toBeVisible();
  await expectDb(`select count(*) from public.events where id = ${lit(created.id)}`, 0, { timeout: DELETE_HOLD_MS + 10_000 });
});

test('an event added from a project calendar belongs to that project; Undo brings a deleted event back', async ({ page }) => {
  await openWorkspace(page, owner, `#/project/${ids.project}/calendar`);
  const title = uniqueName('Sprint demo');
  await page.locator('button[aria-label="New event"]').click();
  const modal = page.locator('.modal');
  await modal.locator('#ev-title').fill(title);
  await modal.locator('#ev-date').fill(dayOfThisMonth(10));
  await modal.locator('#ev-submit').click();
  await expect(chip(page, title)).toBeVisible();
  await expectDb(`select coalesce(project_id::text,'') from public.events where workspace_id = ${lit(ids.ws)} and title = ${lit(title)}`, ids.project);

  await chip(page, title).click();
  await page.locator('.pop [data-a="delEvent"]').click();
  await expect(chip(page, title)).toHaveCount(0);
  await toast(page).locator('.ta', { hasText: 'Undo' }).click();
  await expect(chip(page, title)).toBeVisible();
  await page.waitForTimeout(DELETE_HOLD_MS + 2000); // the undo window is the product's own timer: nothing may be deleted after an undo
  expect(count(`select 1 from public.events where workspace_id = ${lit(ids.ws)} and title = ${lit(title)}`)).toBe(1);
});

test('project milestones are validated, saved sorted by date, shown on the overview and the timeline, and can be edited', async ({ page }) => {
  await openWorkspace(page, owner, `#/project/${ids.project}/overview`);
  const milestones = () => query(`select milestones from public.projects where id = ${lit(ids.project)}`)[0].milestones;
  const beta = { name: 'Beta launch', date: dayOfThisMonth(25) };
  const alpha = { name: 'Alpha', date: dayOfThisMonth(12) };

  await page.locator('[data-a="editProject"]').first().click();
  const modal = page.locator('.modal');
  await modal.locator('[data-a="pmsAdd"]').click();
  await modal.locator('#p-ms-n-0').fill(beta.name);
  await modal.locator('#p-ms-d-0').fill(beta.date);
  await modal.locator('[data-a="pmsAdd"]').click();
  await modal.locator('#p-ms-n-1').fill(alpha.name);
  await modal.locator('#p-ms-d-1').fill(alpha.date);
  // a row with a name and no date is refused
  await modal.locator('[data-a="pmsAdd"]').click();
  await modal.locator('#p-ms-n-2').fill('Broken');
  await modal.locator('#p-ms-d-2').fill('');
  await modal.locator('[data-a="submitProject"]').click();
  await expect(modal.locator('#p-ms-e-2')).toBeVisible();
  await modal.locator('[data-a="pmsRm"][data-i="2"]').click();
  await modal.locator('[data-a="submitProject"]').click();
  await expect(modal).toHaveCount(0);
  await expect.poll(milestones).toEqual([alpha, beta]); // stored in date order

  const panel = page.locator('.panel', { has: page.locator('h2', { hasText: /^Milestones$/ }) });
  await expect(panel).toContainText(alpha.name);
  await expect(panel).toContainText(beta.name);
  await openProjectTab(page, ids.project, 'timeline');
  await expect(page.locator('.ms-w')).toHaveCount(2);
  await expect(page.locator(`.ms-w[data-tip*="${alpha.name}"]`)).toHaveCount(1);

  // edit: rename one, drop the other, add a third; reload shows the same
  await openProjectTab(page, ids.project, 'overview');
  await page.locator('[data-a="editProject"]').first().click();
  await expect(modal.locator('#p-ms-n-0')).toHaveValue(alpha.name);
  await modal.locator('#p-ms-n-0').fill('Alpha (renamed)');
  await modal.locator('[data-a="pmsRm"][data-i="1"]').click();
  await modal.locator('[data-a="pmsAdd"]').click();
  await modal.locator('#p-ms-n-1').fill('Zeta');
  await modal.locator('#p-ms-d-1').fill(dayOfThisMonth(5));
  await modal.locator('[data-a="submitProject"]').click();
  await expect(modal).toHaveCount(0);
  await expect.poll(milestones).toEqual([
    { name: 'Zeta', date: dayOfThisMonth(5) },
    { name: 'Alpha (renamed)', date: alpha.date },
  ]);
  await page.reload();
  await expect(panel).toContainText('Zeta');
  await expect(panel).not.toContainText(beta.name);
});
