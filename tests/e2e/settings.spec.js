/* Settings: theme and other preferences persisted to the profile, notification toggles, profile and workspace details, changing the password,
   and deleting a workspace. */
import {
  PASSWORD,
  anon,
  createUser,
  expect,
  expectDb,
  forgetSession,
  lit,
  newPersonPage,
  onboard,
  openAs,
  openWorkspace,
  pickOption,
  query,
  setupWorkspace,
  skipUnlessReady,
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
  owner = await createUser({ name: 'Settings Owner', tag: 'settings' });
  await openAs(page, owner);
  await onboard(page, { workspace: uniqueName('Settings Space'), project: 'Settings project' });
  ids = await workspaceIds(owner);
  await context.close();
});

const section = async (page, sec) => {
  if (!(await page.locator('.set-nav').count())) await page.locator('nav.side [data-a="go"][data-r="settings"]').click();
  await page.locator(`.set-nav [data-sec="${sec}"]`).click();
  await expect(page.locator('.set-in h1')).toBeVisible();
};
const prefs = user => query(`select prefs, notif_prefs from public.profiles where id = ${lit(user.id)}`)[0];
const theme = page => page.evaluate(() => document.documentElement.getAttribute('data-theme'));

test('the theme and the other appearance preferences are saved to the profile, survive a reload and follow the person to another browser', async ({
  page,
  browser,
}) => {
  await openWorkspace(page, owner);
  await section(page, 'appearance');
  await page.locator('.tcard[data-v="dark"]').click();
  await expect.poll(() => theme(page)).toBe('dark');
  await page.locator('.sw[data-k="accent"][data-v="teal"]').click();
  await page.locator('button[data-k="density"][data-v="compact"]').click();
  await section(page, 'datetime');
  await pickOption(page, page.locator('button.select-btn[aria-label="dateFmt"]'), '2026-10-01');
  await expect(page.locator('.srow', { has: page.locator('[aria-label="dateFmt"]') })).toContainText(/\d{4}-\d{2}-\d{2}/); // the preview follows
  await pickOption(page, page.locator('button.select-btn[aria-label="weekStart"]'), 'Sunday');
  await expect.poll(() => prefs(owner).prefs).toMatchObject({ theme: 'dark', accent: 'teal', density: 'compact', dateFmt: 'yyyy-MM-dd', weekStart: 0 });

  await page.reload();
  await expect(page.locator('.shell')).toBeVisible();
  expect(await theme(page)).toBe('dark');
  await section(page, 'appearance');
  await expect(page.locator('.tcard[data-v="dark"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.sw[data-k="accent"][data-v="teal"]')).toHaveAttribute('aria-checked', 'true');

  // a browser that has never seen this person reads the saved theme from their profile
  const other = await newPersonPage(browser, owner);
  await expect(other.page.locator('.shell')).toBeVisible();
  await expect.poll(() => theme(other.page)).toBe('dark');
  await other.context.close();

  // back to light, so the person's own screen matches what is stored
  await page.locator('.tcard[data-v="light"]').click();
  await expect.poll(() => theme(page)).toBe('light');
  await expect.poll(() => prefs(owner).prefs.theme).toBe('light');
});

test('the theme can also be switched from the account menu', async ({ page }) => {
  await openWorkspace(page, owner);
  const before = await theme(page);
  await page.locator('nav.side [data-pop="user"]').click();
  await page.locator(`.pop [data-a="setTheme"][data-v="${before === 'dark' ? 'light' : 'dark'}"]`).click();
  await expect.poll(() => theme(page)).toBe(before === 'dark' ? 'light' : 'dark');
  await expect.poll(() => prefs(owner).prefs.theme).toBe(before === 'dark' ? 'light' : 'dark');
});

test('notification toggles are saved and kept after a reload', async ({ page }) => {
  await openWorkspace(page, owner);
  await section(page, 'notifications');
  await page.locator('input[data-k="inapp_mention"]').setChecked(false, { force: true });
  await page.locator('input[data-k="inapp_comment"]').setChecked(false, { force: true });
  await expect.poll(() => prefs(owner).notif_prefs).toMatchObject({ inapp_mention: false, inapp_comment: false });
  expect(prefs(owner).notif_prefs.inapp_assign).not.toBe(false);

  await page.reload();
  await expect(page.locator('.shell')).toBeVisible();
  await section(page, 'notifications');
  await expect(page.locator('input[data-k="inapp_mention"]')).not.toBeChecked();
  await expect(page.locator('input[data-k="inapp_assign"]')).toBeChecked();
  await expect(page.locator('input[data-k="inapp_comment"]')).not.toBeChecked();
});

test('the profile and the workspace details are saved', async ({ page }) => {
  await openWorkspace(page, owner);
  await section(page, 'profile');
  await expect(page.locator('#pf-email')).toHaveValue(owner.email);
  await expect(page.locator('#pf-email')).toBeDisabled();
  await page.locator('#pf-name').fill('');
  await page.locator('#pf-save').click();
  await expect(page.locator('.set-in .err')).toContainText('Enter your name');
  await page.locator('#pf-name').fill('Renamed Owner');
  await page.locator('#pf-title').fill('Head of QA');
  await page.locator('#pf-save').click();
  await expect.poll(() => query(`select full_name from public.profiles where id = ${lit(owner.id)}`)[0].full_name).toBe('Renamed Owner');
  await expectDb(`select title from public.members where id = ${lit(ids.member)}`, 'Head of QA');

  await section(page, 'workspace');
  const name = uniqueName('Renamed Space');
  await page.locator('#ws-name').fill(name);
  await page.locator('button[data-a="wsColor"][data-v="#23918A"]').click();
  await page.locator('#ws-save').click();
  await expect(toast(page).filter({ hasText: 'Workspace settings saved' })).toBeVisible();
  await expectDb(`select name||'|'||color from public.workspaces where id = ${lit(ids.ws)}`, `${name}|#23918A`);

  await page.reload();
  await expect(page.locator('.ws-name')).toHaveText(name);
  await expect(page.locator('nav.side [data-pop="user"]')).toContainText('Renamed Owner');
});

test('changing the password checks the current one, refuses weak or mismatched ones, and the new one is what signs in', async ({ page }) => {
  const { user } = await setupWorkspace(page, { name: 'Password Person', tag: 'pw' });
  await section(page, 'password');
  const next = 'brand-new-pass-456';

  await page.locator('#pw-cur').fill('not-my-password');
  await page.locator('#pw-new').fill(next);
  await page.locator('#pw-conf').fill(next);
  await page.locator('#pw-save').click();
  await expect(page.locator('.field', { has: page.locator('#pw-cur') }).locator('.err')).toContainText('current password is incorrect');

  await page.locator('#pw-cur').fill(PASSWORD);
  await page.locator('#pw-new').fill('short');
  await page.locator('#pw-conf').fill('different');
  await page.locator('#pw-save').click();
  await expect(page.locator('.field', { has: page.locator('#pw-new') }).locator('.err')).toBeVisible();
  await expect(page.locator('.field', { has: page.locator('#pw-conf') }).locator('.err')).toContainText("don't match");

  await page.locator('#pw-cur').fill(PASSWORD);
  await page.locator('#pw-new').fill(next);
  await page.locator('#pw-conf').fill(next);
  await page.locator('#pw-save').click();
  await expect(page.locator('.set-in .alert.ok')).toContainText('Password updated');
  await expect(toast(page).filter({ hasText: 'Password updated' })).toBeVisible();

  const attempt = async password => (await anon().auth.signInWithPassword({ email: user.email, password })).error?.message ?? null;
  expect(await attempt(PASSWORD), 'the old password no longer works').toMatch(/invalid login credentials/i);
  expect(await attempt(next), 'the new password works').toBeNull();
  forgetSession(user);
});

test('deleting a workspace asks for its name, removes it and everything in it, and leaves the person at the setup screen', async ({ page }) => {
  const workspace = uniqueName('Doomed Space');
  const { user, ws } = await setupWorkspace(page, { name: 'Delete Person', tag: 'delws', workspace });
  await waitIdle(page);
  await section(page, 'workspace');
  await page.locator('[data-a="delWorkspace"]').click();
  const confirm = page.locator('.modal [data-a="confirmOk"]');
  await expect(confirm).toBeDisabled();
  await page.locator('#confirm-in').fill(workspace);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.locator('.auth-card.onb')).toBeVisible();
  await expectDb(`select count(*) from public.workspaces where id = ${lit(ws)}`, 0);
  await expectDb(`select count(*) from public.projects where workspace_id = ${lit(ws)}`, 0);
  await expectDb(`select count(*) from public.members where user_id = ${lit(user.id)}`, 0);
});
