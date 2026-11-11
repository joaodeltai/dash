/* Shared helpers for the e2e specs.

   Accounts are created with the admin API (confirmed, no e-mail), signed in once through the API and handed to the browser by seeding
   the session the app keeps in localStorage ('dash.auth'). That keeps the auth service's sign-in rate limit (about 30 per 5 minutes per IP)
   out of the way; the sign-in screen itself is exercised in auth.spec.js. Everything else goes through the real interface.
   Ground truth is read straight from Postgres (psql inside the database container), as the integration suite does. */
import { test as base, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { lit, psql, query } from '../integration/env.js';
import { DOMAIN, MAIL_URL, PASSWORD } from './constants.js';

export { expect, lit, query, psql, PASSWORD };
export const BASE_URL = `http://localhost:${Number(process.env.E2E_PORT || 4180)}`;
/* Deletes reach the database after this hold (the undo window), see DELETE_HOLD_MS in src/data/sync.js. */
export const DELETE_HOLD_MS = 6000;

/* When global-setup found the stack unusable, every test (and every beforeAll that would create accounts) skips itself with the reason. */
export const skipUnlessReady = () => base.skip(!!process.env.E2E_SKIP_REASON, `e2e skipped: ${process.env.E2E_SKIP_REASON}`);

/* ---------- test with a skip guard and uncaught-error tracking ---------- */
export const test = base.extend({
  skipGuard: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring pattern, even when no fixture is used
    async ({}, use) => {
      skipUnlessReady();
      await use();
    },
    { auto: true },
  ],
  page: async ({ page }, use) => {
    const errors = trackErrors(page);
    await use(page);
    expect(errors, 'uncaught errors in the page').toEqual([]);
  },
});

/* Uncaught exceptions of a page (not console.error noise such as the 4xx the app provokes on purpose). */
export function trackErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return errors;
}

/* ---------- Supabase access ---------- */
const env = () => ({ url: process.env.E2E_SUPABASE_URL, key: process.env.E2E_SUPABASE_KEY, serviceKey: process.env.E2E_SUPABASE_SERVICE_KEY });
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
let adminClient;
export const admin = () => (adminClient ||= createClient(env().url, env().serviceKey, NO_SESSION));
export const anon = () => createClient(env().url, env().key, NO_SESSION);

export const runId = () => process.env.E2E_RUN;
export function uniqueEmail(tag = 'u') {
  return `e2e-${runId()}-${tag.toLowerCase().replace(/[^a-z0-9]/g, '')}${randomBytes(3).toString('hex')}@${DOMAIN}`;
}
export const uniqueName = prefix => `${prefix} ${runId()}-${randomBytes(2).toString('hex')}`;

/* A confirmed account created by the admin API. */
export async function createUser({ name = 'E2E Person', tag = 'u', password = PASSWORD } = {}) {
  const email = uniqueEmail(tag);
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
  if (error) throw new Error(`create ${email}: ${error.message}`);
  return { id: data.user.id, email, name, password };
}

/* Gives the account a session without a password sign-in: the admin API mints a one-time token (no e-mail is sent) and verifying it counts against
   the auth service's separate verification limit, which keeps the sign-in limit (about 30 per 5 minutes per IP) free for the screens under test.
   Falls back to a password sign-in, retrying when rate-limited. Sessions are cached for the worker, one per account. */
const sessions = new Map();
export async function sessionFor(user) {
  const cached = sessions.get(user.email);
  if (cached && cached.expires_at * 1000 - Date.now() > 10 * 60_000) return cached;
  const link = await admin().auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const hash = link.data?.properties?.hashed_token;
  if (hash) {
    const { data, error } = await anon().auth.verifyOtp({ token_hash: hash, type: 'magiclink' });
    if (!error && data.session) {
      sessions.set(user.email, data.session);
      return data.session;
    }
  }
  let last;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await anon().auth.signInWithPassword({ email: user.email, password: user.password });
    if (!error) {
      sessions.set(user.email, data.session);
      return data.session;
    }
    last = error;
    if (!/rate limit|too many/i.test(error.message)) break;
    await new Promise(r => setTimeout(r, 15_000));
  }
  throw new Error(`sign in ${user.email}: ${last?.message}`);
}
/* The session was ended in the browser (sign out revokes it) or the password changed: sign in again next time. */
export const forgetSession = user => sessions.delete(user.email);

/* Makes the browser context start signed in as `user`. The seed runs only on the first document of each tab, so signing out
   (which clears the stored session) is not undone by a reload. */
export async function seedSession(context, user) {
  const session = await sessionFor(user);
  await context.addInitScript(s => {
    try {
      if (!sessionStorage.getItem('e2e-seeded')) {
        sessionStorage.setItem('e2e-seeded', '1');
        localStorage.setItem('dash.auth', JSON.stringify(s));
      }
    } catch {
      /* storage unavailable: the test will fail on its own */
    }
  }, session);
}

/* Opens the app signed in as `user` and waits for the first screen that is not the splash. */
export async function openAs(page, user, hash = '') {
  await seedSession(page.context(), user);
  await page.goto('/' + hash);
  await page.locator('.shell, .auth-card.onb').first().waitFor();
}

/* A second person in a second browser context (own storage, own tab). */
export async function newPersonPage(browser, user, hash = '') {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = trackErrors(page);
  await openAs(page, user, hash);
  return { context, page, errors };
}

/* ---------- onboarding through the interface ---------- */
export async function onboard(page, { workspace = uniqueName('E2E Space'), project = 'Launch plan', invites = [] } = {}) {
  await expect(page.locator('.auth-card.onb')).toBeVisible();
  await page.locator('#onb-next').click(); // what are you working on
  await page.locator('#o-ws').fill(workspace);
  await page.locator('#onb-next').click(); // workspace
  await page.locator('#onb-next').click(); // how the team works
  await page.locator('#o-proj').fill(project);
  await page.locator('#onb-next').click(); // first project
  if (invites.length) {
    for (const [i, email] of invites.entries()) await page.locator(`#o-inv-${i}`).fill(email);
    await page.locator('#onb-next').click();
  } else await page.locator('button[data-skip="1"]').click();
  await page.locator('#onb-finish').click();
  await expect(page.locator('.shell')).toBeVisible();
  await waitIdle(page);
}

/* A new person with a workspace and a first project, signed in. Returns ids read from the database. */
export async function setupWorkspace(page, { name = 'E2E Owner', tag = 'owner', workspace, project = 'Launch plan' } = {}) {
  const user = await createUser({ name, tag });
  await openAs(page, user);
  await onboard(page, { workspace, project });
  return { user, ...(await workspaceIds(user)) };
}
/* Ids of the person's first workspace, their membership there and its first project, once everything onboarding creates is saved. */
export async function workspaceIds(user) {
  const select = `select m.workspace_id ws, m.id member, p.id project from public.members m left join public.projects p on p.workspace_id = m.workspace_id
    where m.user_id = ${lit(user.id)} order by m.created_at, p.created_at limit 1`;
  await expect.poll(() => query(select)[0]?.project ?? null, { timeout: 15_000, message: 'onboarding saved the first project' }).not.toBeNull();
  return query(select)[0];
}
/* Opens the app for an account that already has a workspace. */
export async function openWorkspace(page, user, hash = '') {
  await openAs(page, user, hash);
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('.shell .sk')).toHaveCount(0);
  await waitIdle(page);
}

/* Nothing is waiting to be saved (the top bar's sync indicator is empty). */
export async function waitIdle(page) {
  await expect(page.locator('#sync-state')).toHaveAttribute('data-s', /^(idle|)$/, { timeout: 20_000 });
}

/* ---------- ground truth ---------- */
export const sql = psql;
export const count = select => Number(psql(`select count(*) from (${select}) t`));
/* Polls Postgres until `select` returns `expected` (the app saves a moment after each interaction). */
export const expectDb = (select, expected, opts = {}) =>
  expect.poll(() => psql(select), { timeout: 15_000, message: `db: ${select}`, ...opts }).toBe(String(expected));

/* ---------- mail (Mailpit) ---------- */
export async function mailLink(to, pattern, { after = 0, timeout = 20_000 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const found = await (await fetch(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent('to:' + to)}`)).json();
    for (const m of found.messages || []) {
      if (new Date(m.Created).getTime() < after) continue;
      const msg = await (await fetch(`${MAIL_URL}/api/v1/message/${m.ID}`)).json();
      const link = (msg.HTML || msg.Text || '').match(pattern)?.[0]?.replace(/&amp;/g, '&');
      if (link) return link;
    }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`no e-mail to ${to} matching ${pattern}`);
}
/* Follows an auth e-mail link on the server side (so no other origin's app ever sees the token) and returns where it redirects, as a path
   and fragment relative to the app under test: whatever origin the auth service put in the redirect, the caller opens it on the test server. */
export async function followAuthLink(link) {
  const res = await fetch(link, { redirect: 'manual' });
  const location = res.headers.get('location');
  if (!location) throw new Error(`auth link did not redirect (HTTP ${res.status})`);
  const target = new URL(location);
  return { path: target.pathname + target.search + target.hash, hash: target.hash };
}

/* ---------- interface shortcuts ---------- */
export const toast = page => page.locator('#toasts .toast');
export const dismissToasts = page => page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
export const goto = async (page, route) => {
  await page.locator(`nav.side [data-a="go"][data-r="${route}"]`).first().click();
};
export const openProjectTab = async (page, projectId, tab) => {
  await page.evaluate(([id, t]) => window.__gr8r.go('project', { id, tab: t }), [projectId, tab]);
  await expect(page.locator('.proj-h')).toBeVisible();
};

/* Creates a task through the "New task" modal of the current project. Returns its id. */
export async function createTaskViaModal(page, title, { desc } = {}) {
  await page.locator('.pbody [data-a="newTask"]').first().click();
  const modal = page.locator('.modal');
  await expect(modal).toBeVisible();
  await modal.locator('#f-title').fill(title);
  if (desc) await modal.locator('#f-desc').fill(desc);
  await modal.locator('#f-submit').click();
  await expect(modal).toHaveCount(0);
  await expectDb(`select count(*) from public.tasks where title = ${lit(title)}`, 1);
  return psql(`select id from public.tasks where title = ${lit(title)}`);
}

/* ---------- auth screens ---------- */
export async function uiLogin(page, email, password) {
  await page.locator('#l-email').fill(email);
  await page.locator('#l-pw').fill(password);
  await page.locator('#login-btn').click();
}
export async function signOutViaUi(page, user) {
  await page.locator('nav.side [data-pop="user"]').click();
  await page.locator('.pop [data-a="signOut"]').click();
  await expect(page.locator('#l-email')).toBeVisible();
  if (user) forgetSession(user); // signing out revokes the session
}

/* The app draws every <select class="select"> as a button plus a menu; this picks an option by its visible text. */
export async function pickOption(page, trigger, text) {
  await trigger.click();
  await page.locator('.select-menu [role="option"]', { hasText: text }).click();
}
/* A date in the current month for the date popover's calendar. */
export const dayOfThisMonth = day => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
export const REALTIME_TIMEOUT = 25_000;
