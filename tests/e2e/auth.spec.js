/* Accounts: sign up with e-mail confirmation, sign in and out, password recovery, deep links after login, a second workspace. */
import {
  PASSWORD,
  count,
  createUser,
  expect,
  expectDb,
  query,
  followAuthLink,
  forgetSession,
  lit,
  mailLink,
  onboard,
  setupWorkspace,
  signOutViaUi,
  sql,
  test,
  uiLogin,
  uniqueEmail,
  uniqueName,
  waitIdle,
} from './helpers.js';

test('signing up needs a strong password, then an e-mailed link, then onboarding creates the workspace', async ({ page }) => {
  const email = uniqueEmail('signup');
  const workspace = uniqueName('Signup Space');
  await page.goto('/#signup');
  await page.locator('#s-name').fill('Sign Up Person');
  await page.locator('#s-email').fill(email);
  await page.locator('#s-pw').fill('short');
  await page.locator('#signup-btn').click();
  await expect(page.locator('#pw-err')).toContainText('at least 10 characters');
  expect(count(`select 1 from auth.users where email = ${lit(email)}`), 'nothing is created for a refused form').toBe(0);

  const sentAfter = Date.now() - 2000;
  await page.locator('#s-pw').fill(PASSWORD);
  await page.locator('#signup-btn').click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await expect(page.locator('.auth-card')).toContainText(email);

  // before the link is followed the app does not let the person in
  await page.locator('#verified-btn').click();
  await expect(page.locator('.toast', { hasText: "haven't seen the confirmation" })).toBeVisible();
  await expect(page.locator('.shell')).toHaveCount(0);

  const link = await mailLink(email, /https?:\/\/[^"'\s<]+verify[^"'\s<]+/, { after: sentAfter });
  await followAuthLink(link);
  await page.locator('#verified-btn').click();
  await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible();
  await onboard(page, { workspace, project: 'Signup project' });

  const account = () =>
    query(`select m.role, m.status, w.name ws, (select count(*)::int from public.projects p where p.workspace_id = w.id) projects,
      (select full_name from public.profiles pr where pr.id = u.id) full_name
      from auth.users u join public.members m on m.user_id = u.id join public.workspaces w on w.id = m.workspace_id where u.email = ${lit(email)}`)[0];
  await expect.poll(account).toMatchObject({ role: 'owner', status: 'active', ws: workspace, projects: 1, full_name: 'Sign Up Person' });
  forgetSession({ email });
});

test('signing up with an address that already has an account is refused with a clear message', async ({ page }) => {
  const existing = await createUser({ name: 'Already Here', tag: 'dup' });
  await page.goto('/#signup');
  await page.locator('#s-name').fill('Someone Else');
  await page.locator('#s-email').fill(existing.email);
  await page.locator('#s-pw').fill('another-pass-99');
  await page.locator('#signup-btn').click();
  await expect(page.locator('#email-err')).toContainText('already exists');
});

test('sign in: wrong password is refused, the right one opens the workspace, sign out returns to the form', async ({ page }) => {
  const { user, ws } = await setupWorkspace(page, { name: 'Login Person', tag: 'login' });
  await signOutViaUi(page, user);

  await uiLogin(page, user.email, 'wrong-password-xx');
  await expect(page.locator('.alert.danger')).toContainText('Incorrect email or password');
  await page.locator('#l-pw').fill(user.password);
  await page.locator('#login-btn').click();
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('#l-email')).toHaveCount(0);
  await expect(page.locator(`nav.side .ws`)).toBeVisible();
  expect(sql(`select count(*) from public.members where workspace_id = ${lit(ws)} and user_id = ${lit(user.id)}`)).toBe('1');
});

test('forgot password: link from the e-mail, weak password refused, new password works and the old one does not', async ({ page }) => {
  const { user } = await setupWorkspace(page, { name: 'Reset Person', tag: 'reset' });
  await signOutViaUi(page, user);

  await page.locator('button[data-a="auth"][data-v="forgot"]').click();
  await page.locator('#f-email').fill(user.email);
  const sentAfter = Date.now() - 2000;
  await page.locator('#forgot-btn').click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  const link = await mailLink(user.email, /https?:\/\/[^"'\s<]+type=recovery[^"'\s<]*/, { after: sentAfter });
  const { path } = await followAuthLink(link);
  await page.goto('about:blank'); // a hash-only change would not reload the app, and the recovery token is read at start-up
  await page.goto(path);
  await expect(page.locator('#r-pw')).toBeVisible();

  await page.locator('#r-pw').fill('short');
  await page.locator('#r-pw2').fill('short');
  await page.locator('#reset-btn').click();
  await expect(page.locator('#pw-err')).toBeVisible();
  await page.locator('#r-pw').fill('brand-new-pass-77');
  await page.locator('#r-pw2').fill('different-pass-77');
  await page.locator('#reset-btn').click();
  await expect(page.locator('#pw2-err')).toContainText("don't match");

  const next = 'brand-new-pass-77';
  await page.locator('#r-pw2').fill(next);
  await page.locator('#reset-btn').click();
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
  await page.locator('#after-reset-btn').click();
  await expect(page.locator('.shell')).toBeVisible();

  await signOutViaUi(page, user);
  await uiLogin(page, user.email, user.password);
  await expect(page.locator('.alert.danger')).toBeVisible();
  await page.locator('#l-pw').fill(next);
  await page.locator('#login-btn').click();
  await expect(page.locator('.shell')).toBeVisible();
});

test('a task link opened while signed out is honoured after signing in', async ({ page }) => {
  const { user, project } = await setupWorkspace(page, { name: 'Link Person', tag: 'link' });
  const taskId = sql(`select id from public.tasks where project_id = ${lit(project)} order by position limit 1`);
  await signOutViaUi(page, user);

  await page.goto(`/#/task/${taskId}`);
  await page.reload();
  await expect(page.locator('#l-email')).toBeVisible();
  await uiLogin(page, user.email, user.password);
  await expect(page.locator('.drawer')).toBeVisible();
  await expect(page.locator('.drawer .mono')).toContainText(sql(`select key from public.tasks where id = ${lit(taskId)}`));
});

test('a second workspace can be created, switched to, and is remembered after a reload', async ({ page }) => {
  const firstName = uniqueName('First Space');
  const { user, ws: firstWs } = await setupWorkspace(page, { name: 'Two Spaces', tag: 'two', workspace: firstName });
  const secondName = uniqueName('Second Space');

  await page.locator('nav.side .ws').click();
  await page.locator('.pop [data-a="newWorkspace"]').click();
  await page.locator('#o-ws').fill(' ');
  await page.locator('#onb-next').click();
  await expect(page.locator('#o-ws-err, .auth-card .err').first()).toContainText('Name your workspace');
  await page.locator('#o-ws').fill(secondName);
  for (let i = 0; i < 3; i++) await page.locator('#onb-next').click();
  await page.locator('button[data-skip="1"]').click();
  await page.locator('#onb-finish').click();
  await expect(page.locator('.ws-name')).toHaveText(secondName);
  await waitIdle(page);

  const rows = JSON.parse(
    sql(
      `select json_agg(w.id order by w.created_at) from public.workspaces w join public.members m on m.workspace_id = w.id where m.user_id = ${lit(user.id)}`,
    ),
  );
  expect(rows).toHaveLength(2);
  expect(rows[0]).toBe(firstWs);

  await page.locator('nav.side .ws').click();
  await page.locator(`.pop [data-a="switchWs"][data-v="${firstWs}"]`).click();
  await expect(page.locator('.ws-name')).toHaveText(firstName);
  await expectDb(`select count(*) from public.workspaces w join public.members m on m.workspace_id = w.id where m.user_id = ${lit(user.id)}`, 2);

  await page.reload();
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('.ws-name')).toHaveText(firstName);
  await page.locator('nav.side .ws').click();
  await expect(page.locator(`.pop [data-a="switchWs"][data-v="${firstWs}"] .ck`)).toBeVisible();
});
