/* Security and robustness: hostile HTML in task text, what a Guest can and cannot do, and the main pages of a brand-new workspace. */
import {
  createTaskViaModal,
  createUser,
  expect,
  expectDb,
  lit,
  newPersonPage,
  openProjectTab,
  openWorkspace,
  pickOption,
  setupWorkspace,
  sql,
  test,
  uniqueName,
  waitIdle,
} from './helpers.js';

const PAYLOAD = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><a href="javascript:window.__xss=3" id="evil">click</a><b id="ok">bold</b>`;
const flagged = page => page.evaluate(() => window.__xss);

test('HTML in a task description is sanitized, whether it comes from a paste in the editor or straight from the database', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', d => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const { user, project } = await setupWorkspace(page, { name: 'Xss Owner', tag: 'xss', project: 'Xss project' });
  await openProjectTab(page, project, 'board');
  const taskId = await createTaskViaModal(page, uniqueName('Description target'));

  const drawerClean = async () => {
    const desc = page.locator('.drawer #d-desc');
    await expect(desc).toBeVisible();
    await expect(desc.locator('b')).toContainText('bold'); // harmless formatting survives
    await expect(desc.locator('img, script, iframe, svg, [onerror], [onload]')).toHaveCount(0);
    for (const a of await desc.locator('a').all()) expect((await a.getAttribute('href')) ?? '').not.toMatch(/^\s*javascript:/i);
    expect(await flagged(page)).toBeUndefined();
  };

  // 1. a real paste into the editor: the clipboard carries the payload as text/html
  await page.locator(`.kcard[data-id="${taskId}"]`).click();
  await page.locator('.drawer #d-desc').click();
  await page.evaluate(html => {
    const data = new DataTransfer();
    data.setData('text/html', html);
    data.setData('text/plain', 'bold');
    document.querySelector('#d-desc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, PAYLOAD);
  await page.keyboard.type(' typed after the paste');
  await page.locator('.drawer #d-title').click();
  await drawerClean();
  await expect.poll(() => sql(`select description from public.tasks where id = ${lit(taskId)}`)).toContain('typed after the paste');
  expect(sql(`select description from public.tasks where id = ${lit(taskId)}`)).not.toMatch(/onerror|<script|javascript:/i);

  // 2. a hostile client writes the raw payload into the database: it must not run when the task is opened
  await waitIdle(page);
  sql(`update public.tasks set description = ${lit(PAYLOAD)} where id = ${lit(taskId)}`);
  await page.goto('about:blank');
  await openWorkspace(page, user, `#/task/${taskId}`);
  await drawerClean();
  expect(dialogs).toEqual([]);
});

test('markup in titles, comments and names is shown as plain text and never runs', async ({ page }) => {
  page.on('dialog', d => void d.dismiss());
  const { project } = await setupWorkspace(page, { name: 'Xss Text', tag: 'xsstext', project: 'Xss text project' });
  await openProjectTab(page, project, 'board');
  const title = `<img src=x onerror="window.__xss='title'"> ${uniqueName('Title')}`;
  const taskId = await createTaskViaModal(page, title);
  await expect(page.locator(`.kcard[data-id="${taskId}"] .title`)).toHaveText(title);
  await page.locator(`.kcard[data-id="${taskId}"]`).click();
  const comment = `<svg onload="window.__xss='comment'"> and <b>not bold</b>`;
  await page.locator('.drawer #d-cmt').fill(comment);
  await page.locator('.drawer [data-a="postComment"]').click();
  await expect(page.locator('.drawer .cmt .txt')).toHaveText(comment); // the markup is the visible text
  await expect(page.locator('.drawer .cmt .txt').locator('b, svg, img')).toHaveCount(0);
  await expect(page.locator('#app img[src="x"], .drawer svg[onload]')).toHaveCount(0);
  expect(await flagged(page)).toBeUndefined();
  await expectDb(`select title from public.tasks where id = ${lit(taskId)}`, title); // stored as typed, escaped only when shown
});

test('a Guest is never offered the controls for creating projects or inviting people', async ({ page, browser }) => {
  const { project, member } = await setupWorkspace(page, { name: 'Guest Host', tag: 'ghost', project: 'Guest project' });
  const guest = await createUser({ name: 'Gus Guest', tag: 'gus' });

  await expect(page.locator('nav.side [data-a="newProject"]'), 'the owner does get the control').toBeVisible();

  // the owner invites the person as a Guest and gives them access to the project
  await page.locator('nav.side .ws').click();
  await page.locator('.pop [data-a="invite"]').click();
  await page.locator('#inv-emails').fill(guest.email);
  await pickOption(page, page.locator('.modal button.select-btn[data-for="inv-role"]'), 'Guest');
  await page.locator('#inv-submit').click();
  await expectDb(`select role||':'||status from public.members where email = ${lit(guest.email)}`, 'guest:invited');
  await openProjectTab(page, project, 'board');
  await page.locator('.proj-h [data-a="share"]').last().click();
  await page.locator('#share-in').fill(guest.email);
  await page.locator('.modal [data-a="shareInvite"]').click();
  await page.locator('.modal [data-a="closeModal"]').last().click();
  await waitIdle(page);

  const G = await newPersonPage(browser, guest);
  const g = G.page;
  await expect(g.locator('.shell')).toBeVisible();
  await expectDb(`select role||':'||status from public.members where email = ${lit(guest.email)}`, 'guest:active');
  await openProjectTab(g, project, 'board');
  await expect(g.locator('.proj-h h1')).toHaveText('Guest project'); // they do see what they were given

  // no way to create a project or to invite, anywhere
  await expect(g.locator('nav.side [data-a="newProject"]')).toHaveCount(0);
  await g.locator('nav.side .ws').click();
  await expect(g.locator('.pop [data-a="switchWs"]').first()).toBeVisible();
  await expect(g.locator('.pop [data-a="invite"]')).toHaveCount(0);
  await g.keyboard.press('Escape');
  await g.locator('nav.side [data-a="go"][data-r="projects"]').click();
  await expect(g.locator('[data-a="newProject"]')).toHaveCount(0);
  await g.locator('nav.side [data-a="go"][data-r="members"]').click();
  await expect(g.locator('[data-a="invite"]')).toHaveCount(0);
  await g.locator('nav.side [data-a="go"][data-r="settings"]').click();
  await g.locator('.set-nav [data-sec="members"]').click();
  await expect(g.locator('.set-in [data-a="invite"]')).toHaveCount(0);
  await g.locator('.crumbs').click();
  await g.keyboard.press('p'); // the new-project shortcut
  await expect(g.locator('.modal')).toHaveCount(0);
  await g.locator('header.topbar [data-pop="create"]').click();
  await expect(g.locator('.pop [data-a="newTask"]')).toBeVisible();
  await expect(g.locator('.pop [data-a="newProject"]')).toHaveCount(0);
  await g.keyboard.press('Escape');

  // and the database agrees: they hold no way to add a project, even if the screen were tampered with
  const before = Number(sql(`select count(*) from public.projects where workspace_id = (select workspace_id from public.members where id = ${lit(member)})`));
  await g.evaluate(async () => {
    const { D } = window.__gr8r;
    const { mutate } = await import('/src/ui/toast.js');
    const { createProject } = await import('/src/actions/actions.js');
    mutate(() => createProject({ name: 'Forged by a guest', icon: 'folder', color: 'rose', team: '', lead: D().me, desc: '' }, 'blank'));
  });
  await expect(g.locator('#toasts .toast').first()).toBeVisible({ timeout: 25_000 });
  expect(Number(sql(`select count(*) from public.projects where workspace_id = (select workspace_id from public.members where id = ${lit(member)})`))).toBe(
    before,
  );
  expect(Number(sql(`select count(*) from public.projects where name = 'Forged by a guest'`))).toBe(0);
  await G.context.close();
});

test('every main page and project tab of a new workspace opens without breaking', async ({ page }) => {
  await setupWorkspace(page, { name: 'Route Walker', tag: 'routes', project: 'Routes project' });
  const broken = async label => {
    const text = await page.locator('#main-content').innerText();
    expect(text, `${label}: error screen`).not.toMatch(/Something went wrong|Couldn't load|Page not found/i);
    expect(text, `${label}: leaked placeholders`).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/);
    await expect(page.locator('#main-content')).toBeVisible();
    await expect(page.locator('.shell .sk')).toHaveCount(0);
  };

  for (const route of [
    'home',
    'inbox',
    'mytasks',
    'favorites',
    'notifications',
    'overview',
    'projects',
    'tasks',
    'calendar',
    'timeline',
    'members',
    'activity',
    'archive',
  ]) {
    await page.locator(`nav.side [data-a="go"][data-r="${route}"]`).first().click();
    await expect(page.locator('.crumbs .cur')).toBeVisible();
    await broken(route);
  }
  // pages without a sidebar entry
  for (const route of ['teams', 'search']) {
    await page.evaluate(r => window.__gr8r.go(r), route);
    await broken(route);
  }
  // every tab of the project
  await page.locator('nav.side .sproj [data-a="go"][data-r="project"]').first().click();
  for (const tab of ['overview', 'board', 'list', 'table', 'calendar', 'timeline', 'files', 'activity']) {
    await page.locator(`.proj-h .tab[data-tab="${tab}"]`).click();
    await expect(page.locator(`.proj-h .tab[data-tab="${tab}"]`)).toHaveAttribute('aria-current', 'page');
    await broken(`project/${tab}`);
  }
  // every settings section
  await page.locator('nav.side [data-a="go"][data-r="settings"]').click();
  const sections = await page.locator('.set-nav [data-sec]').evaluateAll(els => els.map(e => e.dataset.sec));
  expect(sections.length).toBeGreaterThan(10);
  for (const sec of sections) {
    await page.locator(`.set-nav [data-sec="${sec}"]`).click();
    await expect(page.locator('.set-in h1')).toBeVisible();
    await broken(`settings/${sec}`);
  }
  // an address that leads nowhere falls back to the start page
  await page.evaluate(() => {
    location.hash = '#/does-not-exist';
  });
  await expect(page.locator('.crumbs .cur')).toHaveText('Home');
  await broken('unknown route');
});
