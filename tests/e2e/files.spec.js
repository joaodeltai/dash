/* Files: upload from a project and from a task, reload, preview and download with the bytes checked, size limit, rename and delete. */
import { randomBytes } from 'node:crypto';
import { readFileSync, truncateSync, writeFileSync } from 'node:fs';
import {
  DELETE_HOLD_MS,
  count,
  createUser,
  expect,
  expectDb,
  lit,
  onboard,
  openAs,
  openProjectTab,
  openWorkspace,
  query,
  skipUnlessReady,
  sql,
  test,
  uniqueName,
  workspaceIds,
} from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');

let owner;
let ids;

test.beforeAll(async ({ browser }) => {
  skipUnlessReady();
  const context = await browser.newContext();
  const page = await context.newPage();
  owner = await createUser({ name: 'Files Owner', tag: 'files' });
  await openAs(page, owner);
  await onboard(page, { workspace: uniqueName('Files Space'), project: 'Files project' });
  ids = await workspaceIds(owner);
  await context.close();
});

test.beforeEach(async ({ page }) => {
  await openWorkspace(page, owner, `#/project/${ids.project}/files`);
  await expect(page.locator('[data-dropzone]')).toBeVisible();
});

const fileRow = name =>
  query(`select id, size_bytes, storage_path, task_id from public.files where project_id = ${lit(ids.project)} and name = ${lit(name)}`)[0];
const upload = (page, files, scope = '') => page.locator(`${scope} input[data-in="uploadFiles"]`).first().setInputFiles(files);
const downloadBytes = async (page, trigger) => {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
};

test('upload, reload, preview and download return exactly the bytes that went in', async ({ page }) => {
  const stamp = uniqueName('f').replace(/\W/g, '');
  const pngName = `${stamp}-pic.png`;
  const binName = `${stamp}-data.bin`;
  const bin = randomBytes(300_000);
  await upload(page, [
    { name: pngName, mimeType: 'image/png', buffer: PNG },
    { name: binName, mimeType: 'application/octet-stream', buffer: bin },
  ]);
  await expect(page.locator('.fcard', { hasText: pngName })).toBeVisible();
  await expect(page.locator('.fcard', { hasText: binName })).toBeVisible();
  await expect.poll(() => count(`select 1 from public.files where project_id = ${lit(ids.project)} and name in (${lit(pngName)}, ${lit(binName)})`)).toBe(2);

  // stored: database row and object, with the real sizes
  const png = fileRow(pngName);
  const binary = fileRow(binName);
  expect([png.size_bytes, binary.size_bytes]).toEqual([PNG.length, bin.length]);
  expect(sql(`select (metadata->>'size')::int from storage.objects where bucket_id = 'files' and name = ${lit(binary.storage_path)}`)).toBe(String(bin.length));

  await page.reload();
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('.fcard', { hasText: pngName })).toBeVisible();

  // preview an image, then download it from the preview
  await page.locator('.fcard', { hasText: pngName }).click();
  const image = page.locator('.modal img[data-fpath]');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(img => img.naturalWidth)).toBe(10);
  const got = await downloadBytes(page, () => page.locator('.modal [data-a="downloadFile"]').click());
  expect(got.name).toBe(pngName);
  expect(Buffer.compare(got.bytes, PNG)).toBe(0);
  await page.locator('.modal [data-a="closeModal"]').first().click();

  // and download the binary from the context menu
  await page.locator('.fcard', { hasText: binName }).click({ button: 'right' });
  const other = await downloadBytes(page, () => page.locator('.pop [data-a="downloadFile"]').click());
  expect(other.name).toBe(binName);
  expect(other.bytes.length).toBe(bin.length);
  expect(Buffer.compare(other.bytes, bin)).toBe(0);
});

test('a file attached from a task is linked to it, survives a reload and previews', async ({ page }) => {
  const name = `${uniqueName('att').replace(/\W/g, '')}.png`;
  await openProjectTab(page, ids.project, 'board');
  await page.locator('.kcard').first().click();
  const drawer = page.locator('.drawer');
  await expect(drawer).toBeVisible();
  await upload(page, [{ name, mimeType: 'image/png', buffer: PNG }], '.drawer');
  await expect(drawer.locator('.attc', { hasText: name })).toBeVisible();
  await expect.poll(() => fileRow(name)?.task_id, { message: 'the file row is linked to a task' }).toBeTruthy();
  const taskId = fileRow(name).task_id;
  expect(sql(`select project_id from public.tasks where id = ${lit(taskId)}`)).toBe(ids.project);

  await page.goto('about:blank');
  await openWorkspace(page, owner, `#/task/${taskId}`);
  await expect(page.locator('.drawer .attc', { hasText: name })).toBeVisible();
  await page.locator('.drawer .attc', { hasText: name }).click();
  await expect(page.locator('.modal img[data-fpath]')).toBeVisible();
});

test('a file over the size limit is refused and nothing is stored', async ({ page }) => {
  const name = `${uniqueName('big').replace(/\W/g, '')}.bin`;
  const before = count(`select 1 from storage.objects where bucket_id = 'files'`);
  const big = test.info().outputPath(name); // a sparse 51 MB file: the limit is 50 MB
  writeFileSync(big, '');
  truncateSync(big, 51 * 1024 * 1024);
  await upload(page, big);
  await expect(page.locator('#toasts .toast', { hasText: /50 MB|too large|larger/i })).toBeVisible();
  await expect(page.locator('.fcard', { hasText: name })).toHaveCount(0);
  expect(count(`select 1 from public.files where name = ${lit(name)}`)).toBe(0);
  expect(count(`select 1 from storage.objects where bucket_id = 'files'`)).toBe(before);
});

test('renaming changes the stored name; deleting removes the row after the undo window', async ({ page }) => {
  const stamp = uniqueName('r').replace(/\W/g, '');
  const name = `${stamp}-old.png`;
  const renamed = `${stamp}-new.png`;
  await upload(page, [{ name, mimeType: 'image/png', buffer: PNG }]);
  await expect(page.locator('.fcard', { hasText: name })).toBeVisible();
  await expect.poll(() => fileRow(name)?.id).toBeTruthy();
  const { id, storage_path: path } = fileRow(name);
  expect(count(`select 1 from storage.objects where bucket_id = 'files' and name = ${lit(path)}`)).toBe(1);

  await page.locator('.fcard', { hasText: name }).click({ button: 'right' });
  await page.locator('.pop [data-a="renameFile"]').click();
  await page.locator('#prompt-in').fill(renamed);
  await page.locator('.modal [data-a="promptSubmit"]').click();
  await expectDb(`select name from public.files where id = ${lit(id)}`, renamed);

  await page.locator('.fcard', { hasText: renamed }).click({ button: 'right' });
  await page.locator('.pop [data-a="delFile"]').click();
  await page.locator('.modal [data-a="confirmOk"]').click();
  await expect(page.locator('.fcard', { hasText: renamed })).toHaveCount(0);
  await expectDb(`select count(*) from public.files where id = ${lit(id)}`, 0, { timeout: DELETE_HOLD_MS + 10_000 });
  await expectDb(`select count(*) from storage.objects where bucket_id = 'files' and name = ${lit(path)}`, 0); // the stored object goes too
});
