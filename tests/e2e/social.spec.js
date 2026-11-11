/* Social media: accounts, numbers typed by hand and CSV import, through the real interface against the local Supabase.
   Ground truth is read from Postgres. */
import {
  BASE_URL,
  createUser,
  dismissToasts,
  expect,
  expectDb,
  goto,
  lit,
  onboard,
  openAs,
  openWorkspace,
  pickOption,
  psql,
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
  owner = await createUser({ name: 'Social Owner', tag: 'social' });
  await openAs(page, owner);
  await onboard(page, { workspace: uniqueName('Social Space'), project: 'Social project' });
  ids = await workspaceIds(owner);
  await context.close();
});

/* Dates as the database sees them: "today" is the day in São Paulo. */
const dayInSaoPaulo = (offset = 0) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
};
const br = iso => iso.split('-').reverse().join('/');
const snapshots = handle =>
  query(`select s.date::text as date, s.followers, s.views, s.source from public.social_snapshots s join public.social_accounts a on a.id = s.account_id
         where a.workspace_id = ${lit(ids.ws)} and a.handle = ${lit(handle)} order by s.date`);
const dialog = page => page.locator('.soc-dialog .modal');
const openSocial = async page => {
  await openWorkspace(page, owner);
  await goto(page, 'social');
  await expect(page.locator('.ph h1')).toHaveText('Social media');
  await expect(page.locator('.soc-loading')).toHaveCount(0);
};
const addAccount = async (page, { brand, network, handle }) => {
  await page.locator('[data-a="socialAdd"]').first().click();
  await dialog(page).locator('#soc-brand').fill(brand);
  await pickOption(page, dialog(page).locator('button[data-for="soc-platform"]'), network);
  await dialog(page).locator('#soc-handle').fill(handle);
  await dialog(page).locator('[data-a="socialSaveAccount"]').click();
};

test('with no accounts the page offers to add one; an account is validated, added and not duplicated', async ({ page }) => {
  await openSocial(page);
  await expect(page.locator('.empty-state')).toContainText('No accounts yet');
  await page.locator('.empty-state [data-a="socialAdd"]').click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator('#soc-brand')).toBeFocused();

  // nothing typed: the form says what is missing and saves nothing
  await dialog(page).locator('[data-a="socialSaveAccount"]').click();
  await expect(dialog(page).locator('#soc-brand-err')).toHaveText('Give the brand a name.');
  await expect(dialog(page).locator('#soc-handle-err')).toHaveText('Type the account.');

  // Escape closes the dialog and keeps the page
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.empty-state')).toBeVisible();

  await addAccount(page, { brand: 'Acme', network: 'Substack', handle: '@acmeletter' });
  await expect(dialog(page)).toHaveCount(0);
  await expect(toast(page).last()).toContainText('Substack account added');
  await expect(page.locator('.soc-card')).toHaveCount(1);
  await expect(page.locator('.soc-card')).toContainText('acmeletter');
  await expectDb(
    `select platform || '/' || handle || '/' || brand || '/' || is_active from public.social_accounts where workspace_id = ${lit(ids.ws)}`,
    'substack/acmeletter/Acme/true',
  );

  // the same account again, written with other capitals: refused, with the reason next to the field
  await addAccount(page, { brand: 'acme', network: 'Substack', handle: 'AcmeLetter' });
  await expect(dialog(page).locator('#soc-handle-err')).toHaveText('This account is already on the list.');
  await page.keyboard.press('Escape');
  await expectDb(`select count(*) from public.social_accounts where workspace_id = ${lit(ids.ws)}`, 1);

  // a brand typed with other capitals joins the existing brand
  await addAccount(page, { brand: 'ACME ', network: 'Instagram', handle: 'acme' });
  await expect(dialog(page)).toHaveCount(0);
  await expectDb(`select string_agg(distinct brand, ',') from public.social_accounts where workspace_id = ${lit(ids.ws)}`, 'Acme');
});

test('numbers typed by hand are stored once per account and day, for a network with no automatic collection', async ({ page }) => {
  await openSocial(page);
  const row = page.locator('.soc-card', { hasText: 'acmeletter' });
  await row.locator('[data-a="socialNumbers"]').click();
  await expect(dialog(page).locator('label[for="soc-n-followers"]')).toHaveText('Subscribers');
  await expect(dialog(page).locator('#soc-n-date')).toHaveValue(dayInSaoPaulo());

  // not a number: refused next to the field
  await dialog(page).locator('#soc-n-followers').fill('many');
  await dialog(page).locator('[data-a="socialSaveNumbers"]').click();
  await expect(dialog(page).locator('#soc-n-followers-err')).toHaveText('Type a whole number.');
  expect(snapshots('acmeletter')).toEqual([]);

  await dialog(page).locator('#soc-n-followers').fill('1,204');
  await dialog(page).locator('#soc-n-views').fill('5000');
  await dialog(page).locator('[data-a="socialSaveNumbers"]').click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(toast(page).last()).toContainText('Numbers saved for acmeletter');
  expect(snapshots('acmeletter')).toEqual([{ date: dayInSaoPaulo(), followers: 1204, views: 5000, source: 'manual' }]);
  await expect(row.locator('.soc-big')).toHaveText('1,204');
  await dismissToasts(page);

  // the same day again: the page warns, and saving replaces the number instead of adding a line
  await row.locator('[data-a="socialNumbers"]').click();
  await expect(dialog(page).locator('.alert.info')).toContainText('already has numbers');
  await dialog(page).locator('#soc-n-followers').fill('1250');
  await dialog(page).locator('[data-a="socialSaveNumbers"]').click();
  await expect(dialog(page)).toHaveCount(0);
  expect(snapshots('acmeletter')).toEqual([{ date: dayInSaoPaulo(), followers: 1250, views: 5000, source: 'manual' }]);
  await expect(row.locator('.soc-big')).toHaveText('1,250');

  // a day in the future is refused
  await row.locator('[data-a="socialNumbers"]').click();
  await dialog(page).locator('#soc-n-date').fill(dayInSaoPaulo(2));
  await dialog(page).locator('#soc-n-followers').fill('9999');
  await dialog(page).locator('[data-a="socialSaveNumbers"]').click();
  await expect(dialog(page).locator('#soc-n-date-err')).toHaveText("The day can't be in the future.");
  await page.keyboard.press('Escape');
  expect(snapshots('acmeletter')).toHaveLength(1);
});

test('a CSV is checked line by line before it is imported, pasted or from a file', async ({ page }) => {
  await openSocial(page);
  await page.locator('.ph [data-a="socialCsv"]').click();
  await expect(dialog(page)).toBeVisible();

  // pasted, Brazilian style: semicolons, day first, thousands with a dot, accented column names. Two lines are wrong.
  await pickOption(page, dialog(page).locator('button[data-for="soc-c-account"]'), 'acmeletter');
  const pasted = [
    'Data;Seguidores;Visualizações',
    `${br(dayInSaoPaulo(-10))};1.100;300`,
    `${br(dayInSaoPaulo(-9))};1.150;`,
    '31/02/2026;9;9',
    `${br(dayInSaoPaulo(-8))};muitos;1`,
  ].join('\n');
  await dialog(page).locator('#soc-c-text').fill(pasted);
  await expect(dialog(page).locator('.alert.warn')).toContainText('2 days ready to import');
  await expect(dialog(page).locator('.alert.warn')).toContainText('2 lines will be skipped');
  await expect(dialog(page).locator('.soc-problems')).toContainText('"31/02/2026" is not a date');
  await expect(dialog(page).locator('.soc-problems')).toContainText('"muitos" is not a number');
  await dialog(page).locator('[data-a="socialCsvImport"]').click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(toast(page).last()).toContainText('2 days imported');
  expect(snapshots('acmeletter').filter(s => s.source === 'csv')).toEqual([
    { date: dayInSaoPaulo(-10), followers: 1100, views: 300, source: 'csv' },
    { date: dayInSaoPaulo(-9), followers: 1150, views: null, source: 'csv' },
  ]);
  await dismissToasts(page);

  // a file with "platform" and "handle" columns feeds several accounts at once; an unknown account is reported
  await page.locator('.ph [data-a="socialCsv"]').click();
  const file = [
    'date,platform,handle,followers',
    `${dayInSaoPaulo(-5)},substack,acmeletter,1190`,
    `${dayInSaoPaulo(-5)},Instagram,@Acme,8000`,
    `${dayInSaoPaulo(-4)},instagram,acme,8100`,
    `${dayInSaoPaulo(-4)},tiktok,nobody,1`,
  ].join('\n');
  await dialog(page)
    .locator('#soc-c-file')
    .setInputFiles({ name: 'numbers.csv', mimeType: 'text/csv', buffer: Buffer.from('﻿' + file, 'utf8') });
  await expect(dialog(page).locator('.alert.warn')).toContainText('3 days ready to import');
  await expect(dialog(page).locator('.soc-problems')).toContainText('No account matches "tiktok nobody"');
  await dialog(page).locator('[data-a="socialCsvImport"]').click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(toast(page).last()).toContainText('3 days imported for 2 accounts');
  expect(snapshots('acme')).toEqual([
    { date: dayInSaoPaulo(-5), followers: 8000, views: null, source: 'csv' },
    { date: dayInSaoPaulo(-4), followers: 8100, views: null, source: 'csv' },
  ]);
  expect(snapshots('acmeletter').find(s => s.date === dayInSaoPaulo(-5))).toEqual({ date: dayInSaoPaulo(-5), followers: 1190, views: null, source: 'csv' });

  // importing the same file again changes nothing: one line per account and day
  const before = query(`select count(*)::int as n from public.social_snapshots where workspace_id = ${lit(ids.ws)}`)[0].n;
  await page.locator('.ph [data-a="socialCsv"]').click();
  await dialog(page)
    .locator('#soc-c-file')
    .setInputFiles({ name: 'numbers.csv', mimeType: 'text/csv', buffer: Buffer.from(file, 'utf8') });
  await dialog(page).locator('[data-a="socialCsvImport"]').click();
  await expect(dialog(page)).toHaveCount(0);
  expect(query(`select count(*)::int as n from public.social_snapshots where workspace_id = ${lit(ids.ws)}`)[0].n).toBe(before);

  // the way a Brazilian spreadsheet saves it: Windows encoding, semicolons, a blank line first, accented column names
  await page.locator('.ph [data-a="socialCsv"]').click();
  await pickOption(page, dialog(page).locator('button[data-for="soc-c-account"]'), 'acmeletter');
  const latin1 = Buffer.from(`\r\nData;Seguidores;Visualizações\r\n${br(dayInSaoPaulo(-2))};1.300,00;45\r\n`, 'latin1');
  await dialog(page).locator('#soc-c-file').setInputFiles({ name: 'planilha.csv', mimeType: 'text/csv', buffer: latin1 });
  await expect(dialog(page).locator('.alert.ok')).toContainText('1 day ready to import');
  await dialog(page).locator('[data-a="socialCsvImport"]').click();
  await expect(dialog(page)).toHaveCount(0);
  expect(snapshots('acmeletter').find(s => s.date === dayInSaoPaulo(-2))).toEqual({ date: dayInSaoPaulo(-2), followers: 1300, views: 45, source: 'csv' });

  // a file with no usable column is refused with the reason and nothing can be imported
  await page.locator('.ph [data-a="socialCsv"]').click();
  await dialog(page).locator('#soc-c-text').fill('name,total\nx,1');
  await expect(dialog(page).locator('.alert.danger')).toContainText('Nothing to import');
  await expect(dialog(page).locator('.soc-problems')).toContainText('needs a "date" column');
  await expect(dialog(page).locator('[data-a="socialCsvImport"]')).toBeDisabled();
});

test('an account is edited and removed, with its history', async ({ page }) => {
  await openSocial(page);
  const row = page.locator('.soc-card', { hasText: 'acmeletter' });
  await row.locator('[data-a="socialEdit"]').click();
  await expect(dialog(page).locator('#soc-handle')).toHaveValue('acmeletter');
  await dialog(page).locator('#soc-name').fill('Acme Letter');
  await dialog(page).locator('[data-a="socialSaveAccount"]').click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.soc-card', { hasText: 'Acme Letter' })).toHaveCount(1);
  await expectDb(`select display_name from public.social_accounts where workspace_id = ${lit(ids.ws)} and handle = 'acmeletter'`, 'Acme Letter');

  await page.locator('.soc-card', { hasText: 'Acme Letter' }).locator('[data-a="socialRemove"]').click();
  await expect(page.locator('.modal')).toContainText('Remove Acme Letter?');
  await page.locator('.modal [data-a="confirmOk"]').click();
  await expect(toast(page).last()).toContainText('Account removed');
  await expect(page.locator('.soc-card')).toHaveCount(1);
  await expectDb(`select count(*) from public.social_accounts where workspace_id = ${lit(ids.ws)} and handle = 'acmeletter'`, 0);
  await expectDb(
    `select count(*) from public.social_snapshots s where s.workspace_id = ${lit(ids.ws)} and not exists (select 1 from public.social_accounts a where a.id = s.account_id)`,
    0,
  );
});

/* ---------- dashboard: a workspace seeded with numbers whose result is known ----------
   X (Acme, Instagram): 1000 forty days ago, 1200 thirty, 1500 ten, 1600 seven, 1700 three, 1800 today
   Y (Acme, TikTok):    500 five days ago, 650 today
   Z (Beta, YouTube):   no numbers
   Instagram's last automatic collection failed; TikTok's worked. */
test.describe('dashboard', () => {
  let boss;
  let ws;
  const X = '11111111-1111-4111-8111-111111111111'.replace(/1/g, () => Math.floor(Math.random() * 10));
  const Y = '22222222-2222-4222-8222-222222222222'.replace(/2/g, () => Math.floor(Math.random() * 10));
  const Z = '33333333-3333-4333-8333-333333333333'.replace(/3/g, () => Math.floor(Math.random() * 10));
  const shot = async (page, name) => {
    if (!process.env.E2E_SHOTS) return;
    // the app scrolls inside its content area: let it grow for the picture, so the whole page is captured
    await page.waitForTimeout(400); // let the entrance animation of a dialog finish
    const style = await page.addStyleTag({ content: 'html,body,#app,.shell,.main,.content{height:auto!important;overflow:visible!important}' });
    await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true });
    await style.evaluate(el => el.remove());
  };
  const noSideScroll = async (page, what) => {
    const m = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      content: document.querySelector('.content')?.scrollWidth ?? 0,
      win: innerWidth,
      wide: [...document.querySelectorAll('.content *, .soc-dialog *')]
        .filter(el => el.getBoundingClientRect().right > innerWidth + 0.5 && !el.closest('.soc-table-wrap'))
        .map(el => el.className || el.tagName)
        .slice(0, 5),
    }));
    expect(m.doc, `${what}: page width`).toBeLessThanOrEqual(m.win);
    expect(m.content, `${what}: content width`).toBeLessThanOrEqual(m.win);
    expect(m.wide, `${what}: elements past the right edge`).toEqual([]);
  };

  test.beforeAll(async ({ browser }) => {
    skipUnlessReady();
    const context = await browser.newContext();
    const page = await context.newPage();
    boss = await createUser({ name: 'Dash Owner', tag: 'socialdash' });
    await openAs(page, boss);
    await onboard(page, { workspace: uniqueName('Dash Space'), project: 'Dash project' });
    ws = (await workspaceIds(boss)).ws;
    await context.close();
    const d = n => dayInSaoPaulo(n);
    psql(`insert into public.social_accounts (id, workspace_id, brand, platform, handle, display_name) values
      (${lit(X)}, ${lit(ws)}, 'Acme', 'instagram', 'acme', ''), (${lit(Y)}, ${lit(ws)}, 'Acme', 'tiktok', 'acme.tt', ''), (${lit(Z)}, ${lit(ws)}, 'Beta', 'youtube', 'beta', 'Beta Channel')`);
    psql(`insert into public.social_snapshots (account_id, date, followers, source) values
      (${lit(X)}, ${lit(d(-40))}, 1000, 'apify'), (${lit(X)}, ${lit(d(-30))}, 1200, 'apify'), (${lit(X)}, ${lit(d(-10))}, 1500, 'apify'),
      (${lit(X)}, ${lit(d(-7))}, 1600, 'apify'), (${lit(X)}, ${lit(d(-3))}, 1700, 'apify'), (${lit(X)}, ${lit(d(0))}, 1800, 'apify'),
      (${lit(Y)}, ${lit(d(-5))}, 500, 'csv'), (${lit(Y)}, ${lit(d(0))}, 650, 'manual')`);
    psql(`insert into public.social_posts (account_id, external_id, url, caption, post_type, posted_at, likes, comments, shares, views) values
      (${lit(X)}, 'p1', 'https://example.invalid/p/1', 'First <b>post</b>', 'Image', now() - interval '3 days', 100, 20, 5, null),
      (${lit(X)}, 'p2', 'https://example.invalid/p/2', 'Second post', 'Video', now() - interval '2 days', 300, 40, null, 9000),
      (${lit(Y)}, 'v1', 'javascript:alert(1)', '', '', now() - interval '1 day', 50, 5, 2, 1000)`);
    psql(`insert into public.social_collect_runs (workspace_id, platform, status, message, accounts_total, accounts_ok, started_at, finished_at) values
      (${lit(ws)}, 'instagram', 'success', '', 1, 1, now() - interval '1 day', now() - interval '1 day'),
      (${lit(ws)}, 'instagram', 'error', 'actor some/actor failed (HTTP 400): run status FAILED', 1, 0, now() - interval '1 hour', now() - interval '1 hour'),
      (${lit(ws)}, 'tiktok', 'success', '', 1, 1, now() - interval '1 hour', now() - interval '1 hour')`);
    psql(`insert into public.social_goals (account_id, target_value, target_date) values (${lit(X)}, 5000, ${lit(d(30))})`);
  });

  const open = async page => {
    await openWorkspace(page, boss);
    await goto(page, 'social');
    await expect(page.locator('.soc-cards')).toBeVisible();
  };
  const card = (page, id) => page.locator(`.soc-card[data-account="${id}"]`);

  test('warns when the last collection of a network failed, and only for that network', async ({ page }) => {
    await open(page);
    const alert = page.locator('.soc-alert');
    await expect(alert).toHaveCount(1);
    await expect(alert).toHaveAttribute('data-platform', 'instagram');
    await expect(alert).toContainText('Instagram: the last automatic collection failed.');
    await expect(alert).toContainText('actor some/actor failed (HTTP 400): run status FAILED');
    await expect(card(page, X).locator('.badge.red')).toHaveText('Collection failed');
    await expect(card(page, Y).locator('.badge.red')).toHaveCount(0);

    // the alert leads straight to typing today's numbers for that network
    await alert.locator('[data-a="socialNumbers"]').click();
    await expect(dialog(page).locator('#soc-n-account')).toHaveValue(X);
    await page.keyboard.press('Escape');

    // once a collection of that network works again the alert goes away
    psql(
      `insert into public.social_collect_runs (workspace_id, platform, status, accounts_total, accounts_ok) values (${lit(ws)}, 'instagram', 'success', 1, 1)`,
    );
    await page.reload();
    await goto(page, 'social');
    await expect(page.locator('.soc-cards')).toBeVisible();
    await expect(page.locator('.soc-alert')).toHaveCount(0);
    psql(
      `delete from public.social_collect_runs where workspace_id = ${lit(ws)} and platform = 'instagram' and status = 'success' and finished_at > now() - interval '5 minutes'`,
    );
  });

  test('shows totals, a card per account, totals per brand, goals and the best posts', async ({ page }) => {
    await open(page);
    const stat = n => page.locator('.soc-stats .stat').nth(n);
    await expect(stat(0)).toContainText('2,450');
    await expect(stat(0)).toContainText('3 accounts');
    await expect(stat(1)).toContainText('+350');
    await expect(stat(1)).toContainText('+16.7%');
    await expect(stat(2)).toContainText('+750');
    await expect(stat(2)).toContainText('+44.1%');
    await expect(stat(3)).toContainText('+950');
    await expect(stat(3)).toContainText('+63.3%');

    await expect(page.locator('.soc-card')).toHaveCount(3);
    await expect(card(page, X).locator('.soc-big')).toHaveText('1,800');
    await expect(card(page, X).locator('.soc-card-d')).toContainText('+200');
    await expect(card(page, X).locator('.soc-card-d')).toContainText('+12.5%');
    await expect(card(page, X).locator('.soc-card-d')).toContainText('+600');
    await expect(card(page, X).locator('.soc-card-d')).toContainText('+50%');
    await expect(card(page, X).locator('.soc-goal')).toContainText('36%');
    await expect(card(page, X).locator('.soc-card-f')).toContainText('collected automatically');
    await expect(card(page, Y).locator('.soc-big')).toHaveText('650');
    await expect(card(page, Y).locator('.soc-card-f')).toContainText('typed by hand');
    await expect(card(page, Z)).toContainText('No numbers yet');
    await expect(card(page, Z)).toContainText('Subscribers');

    const brand = name => page.locator('.soc-brow', { hasText: name });
    await expect(brand('Acme')).toContainText('2,450');
    await expect(brand('Acme')).toContainText('+350');
    await expect(brand('Acme')).toContainText('+16.7%');
    await expect(brand('Acme')).toContainText('+750');
    await expect(brand('Acme')).toContainText('+950');
    await expect(brand('Beta')).toContainText('1 account');
    await expect(brand('Beta')).not.toContainText('+');

    const goal = page.locator('.soc-goals .soc-grow');
    await expect(goal).toHaveCount(1);
    await expect(goal).toContainText('1,800 / 5,000');
    await expect(goal).toContainText('36%');
    await expect(goal).toContainText('3,200 to go · 107 a day until');

    // best posts: ordered by likes + comments + shares; text from the network is shown as text, never as markup
    const posts = page.locator('.soc-post');
    await expect(posts).toHaveCount(3);
    await expect(posts.nth(0)).toContainText('Second post');
    await expect(posts.nth(0).locator('.soc-post-e b')).toHaveText('340');
    await expect(posts.nth(1)).toContainText('First <b>post</b>');
    await expect(posts.nth(1).locator('.soc-post-e b')).toHaveText('125');
    await expect(posts.nth(2)).toContainText('No caption');
    await expect(posts.nth(0).locator('a[href="https://example.invalid/p/2"]')).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(posts.nth(2).locator('a')).toHaveCount(0); // an address that is not http(s) never becomes a link
    await shot(page, 'light-desktop');
  });

  test('the chart follows the filters, can be read day by day and has a table', async ({ page }) => {
    await open(page);
    const panel = page.locator('.soc-chart-panel');
    await expect(panel.locator('.soc-line')).toHaveCount(1);
    await expect(panel.locator('.soc-chart-n .soc-big')).toHaveText('2,450');
    await expect(panel.locator('.soc-chart-n')).toContainText('+950'); // 90 days: from 1,500 (X at 1,000 plus Y at its first number, 500) to 2,450

    // reading one day: the keyboard walks along the line
    const plot = panel.locator('.soc-plot');
    await plot.focus();
    await page.keyboard.press('End');
    await expect(plot.locator('.soc-tip')).toBeVisible();
    await expect(plot.locator('.soc-tip b')).toHaveText('2,450');
    await page.keyboard.press('Home');
    await expect(plot.locator('.soc-tip b')).toHaveText('1,500');
    await page.keyboard.press('Escape');
    await expect(plot.locator('.soc-tip')).toBeHidden();
    // and so does the pointer
    const box = await plot.boundingBox();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await expect(plot.locator('.soc-tip b')).toHaveText('2,450');

    // period
    await panel.locator('[data-a="socialPeriod"][data-v="7"]').click();
    await expect(panel.locator('[data-a="socialPeriod"][data-v="7"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.soc-chart-n')).toContainText('+350'); // 2,100 seven days ago, the same change the totals show

    // one account
    await pickOption(page, panel.locator('button.select-btn[aria-label="Account"]'), 'TikTok');
    await expect(panel.locator('.soc-chart-n .soc-big')).toHaveText('650');
    await pickOption(page, panel.locator('button.select-btn[aria-label="Account"]'), 'All accounts');

    // table
    await panel.locator('[data-a="socialToggleTable"]').click();
    await expect(panel.locator('.soc-table tbody tr').first()).toContainText('2,450');
    await expect(panel.locator('.soc-chart')).toHaveCount(0);
    await panel.locator('[data-a="socialToggleTable"]').click();
    await expect(panel.locator('.soc-line')).toHaveCount(1);

    // page filters: network, then brand (back at the top first: an open menu closes when the page scrolls)
    await page.locator('.content').evaluate(el => el.scrollTo(0, 0));
    await pickOption(page, page.locator('.soc-filters button.select-btn[aria-label="Network"]'), 'Instagram');
    await expect(page.locator('.soc-card')).toHaveCount(1);
    await expect(page.locator('.soc-stats .stat').first()).toContainText('1,800');
    await expect(page.locator('.soc-post')).toHaveCount(2);
    await page.locator('[data-a="socialClearFilters"]').click();
    await pickOption(page, page.locator('.soc-filters button.select-btn[aria-label="Brand"]'), 'Beta');
    await expect(page.locator('.soc-card')).toHaveCount(1);
    await expect(panel).toContainText('No numbers in this period.');
    await expect(page.locator('.soc-brow')).toHaveCount(3); // the brand totals always list every brand
    await page.locator('[data-a="socialClearFilters"]').click();
    await expect(page.locator('.soc-card')).toHaveCount(3);
  });

  test('a goal is set, changed and removed from the card of the account', async ({ page }) => {
    await open(page);
    await card(page, Y).locator('[data-a="socialGoal"]').click();
    await expect(dialog(page).locator('#soc-g-now')).toHaveText('Today: 650');
    await dialog(page).locator('[data-a="socialSaveGoal"]').click();
    await expect(dialog(page).locator('#soc-g-target-err')).toHaveText('Type the number to reach.');
    await dialog(page).locator('#soc-g-target').fill('1,000');
    await dialog(page).locator('[data-a="socialSaveGoal"]').click();
    await expect(dialog(page)).toHaveCount(0);
    await expectDb(`select target_value || '/' || coalesce(target_date::text, 'none') from public.social_goals where account_id = ${lit(Y)}`, '1000/none');
    await expect(card(page, Y).locator('.soc-goal')).toContainText('65%');
    await expect(page.locator('.soc-goals .soc-grow')).toHaveCount(2);

    await card(page, Y).locator('[data-a="socialGoal"]').click();
    await expect(dialog(page).locator('#soc-g-target')).toHaveValue('1000');
    await dialog(page).locator('#soc-g-target').fill('650');
    await dialog(page).locator('[data-a="socialSaveGoal"]').click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.soc-goals .soc-grow', { hasText: 'acme.tt' })).toContainText('Reached');
    await expectDb(`select count(*) from public.social_goals where account_id = ${lit(Y)}`, 1);

    await card(page, Y).locator('[data-a="socialGoal"]').click();
    await dialog(page).locator('[data-a="socialDeleteGoal"]').click();
    await expect(dialog(page)).toHaveCount(0);
    await expectDb(`select count(*) from public.social_goals where account_id = ${lit(Y)}`, 0);
    await expect(card(page, Y).locator('.soc-goal')).toHaveCount(0);
  });

  test('fits a 375px screen without sideways scrolling, in light and dark, with every dialog open', async ({ browser }) => {
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 375, height: 760 }, colorScheme: scheme, hasTouch: true });
      const page = await context.newPage();
      await openAs(page, boss);
      await expect(page.locator('.shell')).toBeVisible();
      await page.evaluate(() => window.__gr8r.go('social'));
      await expect(page.locator('.soc-cards')).toBeVisible();
      await expect(page.locator('.soc-alert')).toHaveCount(1);
      await noSideScroll(page, `${scheme} page`);
      await shot(page, `${scheme}-375`);
      // the theme tokens are in force: the page background is the theme's surface
      const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.soc-card')).backgroundColor);
      expect(bg).toBe(scheme === 'dark' ? 'rgb(29, 29, 28)' : 'rgb(255, 255, 255)');

      for (const [action, name] of [
        ['socialAdd', 'account'],
        ['socialNumbers', 'numbers'],
        ['socialCsv', 'csv'],
      ]) {
        await page.locator(`.ph [data-a="${action}"]`).click();
        await expect(dialog(page)).toBeVisible();
        if (name === 'csv') {
          await dialog(page).locator('#soc-c-text').fill('date,followers\n2026-01-31,many\nnot-a-date,5');
          await expect(dialog(page).locator('.soc-problems')).toBeVisible();
        }
        await noSideScroll(page, `${scheme} ${name} dialog`);
        await shot(page, `${scheme}-375-${name}`);
        await dialog(page).locator('[data-a="socialClose"]').first().click();
        await expect(dialog(page)).toHaveCount(0);
      }
      await page.locator(`.soc-card[data-account="${X}"] [data-a="socialGoal"]`).click();
      await noSideScroll(page, `${scheme} goal dialog`);
      await shot(page, `${scheme}-375-goal`);
      await dialog(page).locator('[data-a="socialClose"]').first().click();

      // the chart as a table also stays inside the screen
      await page.locator('[data-a="socialToggleTable"]').click();
      await noSideScroll(page, `${scheme} table`);
      await page.locator('[data-a="socialToggleTable"]').click();
      // touch: tapping the chart shows that day
      const plot = page.locator('.soc-plot');
      await plot.scrollIntoViewIfNeeded();
      const box = await plot.boundingBox();
      await page.touchscreen.tap(box.x + box.width - 3, box.y + box.height / 2);
      await expect(plot.locator('.soc-tip b')).toHaveText('2,450');
      await noSideScroll(page, `${scheme} chart with the day box`);
      await context.close();
    }
  });

  test('reads in Portuguese when the interface is in pt-BR', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 }, locale: 'pt-BR', colorScheme: 'dark' });
    const page = await context.newPage();
    await openAs(page, boss);
    await expect(page.locator('.shell')).toBeVisible();
    await page.evaluate(() => {
      window.__gr8r.S.prefs.lang = 'pt-BR';
      window.__gr8r.go('social');
    });
    await expect(page.locator('.ph h1')).toHaveText('Redes sociais');
    await expect(page.locator('nav.side [data-r="social"]')).toContainText('Redes sociais');
    await expect(page.locator('.soc-alert')).toContainText('Instagram: a última coleta automática falhou.');
    await expect(page.locator('.soc-stats .stat').nth(0)).toContainText('Audiência');
    await expect(page.locator('.soc-stats .stat').nth(0)).toContainText('2.450');
    await expect(page.locator('.soc-stats .stat').nth(1)).toContainText('+16,7%');
    await expect(page.locator('.soc-chart-panel h2')).toHaveText('Crescimento');
    await expect(page.locator('.ph .acts')).toContainText('Lançar números');
    await expect(page.locator('.ph .acts')).toContainText('Importar CSV');
    await expect(page.locator('.ph .acts')).toContainText('Adicionar conta');
    await shot(page, 'dark-desktop-pt');
    // no English left on the page: every visible text of the page is known to the Portuguese dictionary
    const english = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '.soc-page h1, .soc-page h2, .soc-page .k, .soc-page dt, .soc-page [role="columnheader"], .soc-page .btn, .soc-page .seg + .ibtn',
        ),
      ]
        .map(el => el.textContent.trim())
        .filter(t => /\b(the|and|days|accounts?|goals?|brand|growth|audience|since|best|posts|enter|import|add|totals)\b/i.test(t)),
    );
    expect(english).toEqual([]);
    await context.close();
  });
});
