/* Social media: accounts, numbers typed by hand and CSV import, through the real interface against the local Supabase.
   Ground truth is read from Postgres. */
import {
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
  await expect(page.locator('.soc-arow')).toHaveCount(1);
  await expect(page.locator('.soc-arow')).toContainText('acmeletter');
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
  const row = page.locator('.soc-arow', { hasText: 'acmeletter' });
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
  await expect(row.locator('.soc-anum b')).toHaveText('1,204');
  await dismissToasts(page);

  // the same day again: the page warns, and saving replaces the number instead of adding a line
  await row.locator('[data-a="socialNumbers"]').click();
  await expect(dialog(page).locator('.alert.info')).toContainText('already has numbers');
  await dialog(page).locator('#soc-n-followers').fill('1250');
  await dialog(page).locator('[data-a="socialSaveNumbers"]').click();
  await expect(dialog(page)).toHaveCount(0);
  expect(snapshots('acmeletter')).toEqual([{ date: dayInSaoPaulo(), followers: 1250, views: 5000, source: 'manual' }]);
  await expect(row.locator('.soc-anum b')).toHaveText('1,250');

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

  // a file with no usable column is refused with the reason and nothing can be imported
  await page.locator('.ph [data-a="socialCsv"]').click();
  await dialog(page).locator('#soc-c-text').fill('name,total\nx,1');
  await expect(dialog(page).locator('.alert.danger')).toContainText('Nothing to import');
  await expect(dialog(page).locator('.soc-problems')).toContainText('needs a "date" column');
  await expect(dialog(page).locator('[data-a="socialCsvImport"]')).toBeDisabled();
});

test('an account is edited and removed, with its history', async ({ page }) => {
  await openSocial(page);
  const row = page.locator('.soc-arow', { hasText: 'acmeletter' });
  await row.locator('[data-a="socialEdit"]').click();
  await expect(dialog(page).locator('#soc-handle')).toHaveValue('acmeletter');
  await dialog(page).locator('#soc-name').fill('Acme Letter');
  await dialog(page).locator('[data-a="socialSaveAccount"]').click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.soc-arow', { hasText: 'Acme Letter' })).toHaveCount(1);
  await expectDb(`select display_name from public.social_accounts where workspace_id = ${lit(ids.ws)} and handle = 'acmeletter'`, 'Acme Letter');

  await page.locator('.soc-arow', { hasText: 'Acme Letter' }).locator('[data-a="socialRemove"]').click();
  await expect(page.locator('.modal')).toContainText('Remove Acme Letter?');
  await page.locator('.modal [data-a="confirmOk"]').click();
  await expect(toast(page).last()).toContainText('Account removed');
  await expect(page.locator('.soc-arow')).toHaveCount(1);
  await expectDb(`select count(*) from public.social_accounts where workspace_id = ${lit(ids.ws)} and handle = 'acmeletter'`, 0);
  await expectDb(
    `select count(*) from public.social_snapshots s where s.workspace_id = ${lit(ids.ws)} and not exists (select 1 from public.social_accounts a where a.id = s.account_id)`,
    0,
  );
});
