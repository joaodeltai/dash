/* ---------- SOCIAL MEDIA ----------
   Audience growth of the workspace's social accounts. Numbers arrive from the daily automatic collection, from the
   "Enter numbers" form or from a CSV file; this page reads them straight from the database (./data.js).

   The dialogs are drawn by this page with the app's modal classes, so nothing has to be registered in the
   app-wide modal list. */
import '../styles/pages/social.css';
import './actions.js';
import { esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { tr, trn, shortDay } from '../core/i18n.js';
import { D, S, canCreate } from '../core/store.js';
import { ctx } from '../data/supabase.js';
import { empty } from '../ui/helpers.js';
import { render } from '../shell/render.js';
import { SOC, accountById, growthOf, loadSocial, resetSocial } from './data.js';
import { PLATFORMS, audienceLabel, handleHint, platformName, platformOf, profileUrl } from './platforms.js';
import { CSV_COLUMNS, fmtNum, todayIn } from './logic.js';

/* ---------- small pieces ---------- */
export const dateText = d => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return shortDay(new Date(y, m - 1, day), y !== new Date().getFullYear());
};
export const mark = platform => `<span class="soc-mark" aria-hidden="true">${esc(platformOf(platform).mark)}</span>`;
export const accountLabel = a => `${platformName(a.platform)} · ${a.display_name || a.handle}`;
const err = (key, id) => (SOC.errors[key] ? `<span class="err" id="${id}" role="alert">${ic('circle-alert', 12)}${esc(SOC.errors[key])}</span>` : '');
const invalid = key => (SOC.errors[key] ? 'is-error' : '');
const option = (value, label, current) => `<option value="${esc(value)}" ${String(current ?? '') === String(value) ? 'selected' : ''}>${esc(label)}</option>`;
const accountOptions = current => SOC.accounts.map(a => option(a.id, `${a.brand} · ${accountLabel(a)}`, current)).join('');

/* ---------- loading ---------- */
let kicked = false;
function ensureLoaded() {
  if (SOC.user !== ctx.userId) {
    resetSocial(); // another person signed in on this tab: nothing of the previous one stays on screen
    SOC.user = ctx.userId;
  }
  // coming back to the page after a while reads the numbers again, quietly
  const stale = SOC.status === 'ready' && Date.now() - (SOC.loadedAt || 0) > 60000 && SOC.nav !== S.ui.history.length;
  if (SOC.ws === ctx.wsId && SOC.status !== 'idle' && !stale) return;
  if (kicked) return;
  kicked = true;
  queueMicrotask(() => {
    kicked = false;
    const silent = stale && SOC.ws === ctx.wsId;
    SOC.nav = S.ui.history.length;
    loadSocial({ silent }).then(() => {
      SOC.loadedAt = Date.now();
      if (S.ui.route === 'social') render();
    });
    if (!silent && S.ui.route === 'social') render();
  });
}
/* A dialog belongs to the visit in which it was opened: leaving the page closes it. */
function dropStaleDialog() {
  if (SOC.dialog && SOC.dialog.nav !== S.ui.history.length) Object.assign(SOC, { dialog: null, form: {}, errors: {}, csv: null, busy: false });
}

/* ---------- page ---------- */
export function pageSocial() {
  if (!canCreate())
    return `<div class="page">${empty('lock', tr('Social media is for workspace members'), tr("Guests don't have access to this area. Ask a workspace admin if you need it."))}</div>`;
  ensureLoaded();
  dropStaleDialog();
  const head = (acts = '') =>
    `<div class="ph"><div><h1>${tr('Social media')}</h1><p>${tr('Audience growth of every brand in {name}.', { name: esc(D().ws.name) })}</p></div>${acts ? `<div class="acts">${acts}</div>` : ''}</div>`;

  if (SOC.status === 'idle' || SOC.status === 'loading')
    return `<div class="page">${head()}<div class="soc-loading" role="status" aria-label="${tr('Loading…')}"><span class="sk" style="height:76px"></span><span class="sk" style="height:220px"></span><span class="sk" style="height:140px"></span></div></div>`;
  if (SOC.status === 'unavailable')
    return `<div class="page">${head()}${empty('database', tr("Social media isn't set up here yet"), tr("This environment's database doesn't have the social media tables yet. Whoever manages the project needs to finish the setup."))}</div>`;
  if (SOC.status === 'error')
    return `<div class="page">${head()}${empty('circle-alert', tr("Couldn't load social media"), tr('Check your connection and try again.'), `<button class="btn btn-secondary" data-a="socialRetry">${ic('refresh-cw', 14)}${tr('Try again')}</button>`, 'err')}</div>`;

  const addBtn = `<button class="btn btn-primary" data-a="socialAdd">${ic('plus', 14)}${tr('Add account')}</button>`;
  if (!SOC.accounts.length)
    return `<div class="page">${head()}${empty(
      'trending-up',
      tr('No accounts yet'),
      tr('Add the social accounts you want to follow. Their numbers can come from the daily collection, from the form or from a CSV file.'),
      addBtn,
    )}</div>${dialogHtml()}`;

  const acts = `<button class="btn btn-secondary" data-a="socialCsv">${ic('upload', 14)}${tr('Import CSV')}</button><button class="btn btn-secondary" data-a="socialNumbers">${ic('pencil-line', 14)}${tr('Enter numbers')}</button>${addBtn}`;
  return `<div class="page">${head(acts)}${accountsPanel()}</div>${dialogHtml()}`;
}

/* The accounts with their latest number. */
export function accountsPanel() {
  const rows = SOC.accounts
    .map(a => {
      const g = growthOf(a.id);
      const link = profileUrl(a);
      const name = esc(a.display_name || a.handle);
      return `<div class="soc-arow">
        ${mark(a.platform)}
        <div class="soc-aname"><b class="trunc">${link ? `<a class="link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${name}</a>` : name}</b><span class="faint trunc">${esc(platformName(a.platform))} · ${esc(a.brand)}${a.is_active ? '' : ' · ' + tr('collection paused')}</span></div>
        <div class="soc-anum"><b class="num">${g && g.followers !== null && g.followers !== undefined ? fmtNum(g.followers) : '—'}</b><span class="faint">${g && g.last_date ? dateText(g.last_date) : tr('no numbers yet')}</span></div>
        <div class="soc-aacts">
          <button class="ibtn ibtn-sm" data-a="socialNumbers" data-id="${a.id}" data-tip="${tr('Enter numbers')}" aria-label="${tr('Enter numbers for {name}', { name })}">${ic('pencil-line', 15)}</button>
          <button class="ibtn ibtn-sm" data-a="socialEdit" data-id="${a.id}" data-tip="${tr('Edit account')}" aria-label="${tr('Edit {name}', { name })}">${ic('settings-2', 15)}</button>
          <button class="ibtn ibtn-sm" data-a="socialRemove" data-id="${a.id}" data-tip="${tr('Remove account')}" aria-label="${tr('Remove {name}', { name })}">${ic('trash-2', 15)}</button>
        </div>
      </div>`;
    })
    .join('');
  return `<section class="panel"><div class="panel-h"><h2>${tr('Accounts')}</h2><div class="acts"><span class="faint" style="font-size:11.5px">${trn('{n} account', '{n} accounts', SOC.accounts.length)}</span></div></div><div class="soc-alist">${rows}</div></section>`;
}

/* ---------- dialogs ---------- */
function frame(size, title, sub, body, footer) {
  const fresh = SOC.dialog.fresh;
  SOC.dialog.fresh = false;
  return `<div class="scrim${fresh ? ' enter' : ''}" data-a="socialClose"></div><div class="modal-wrap soc-dialog" data-a="socialCloseBg"><div class="modal ${size}${fresh ? ' enter' : ''}" role="dialog" aria-modal="true" aria-labelledby="soc-dlg-h">
    <div class="modal-h"><div><h2 id="soc-dlg-h">${title}</h2>${sub ? `<div class="muted" style="font-size:12.5px;margin-top:2px">${sub}</div>` : ''}</div><button class="ibtn ibtn-sm" data-a="socialClose" aria-label="${tr('Close')}">${ic('x', 16)}</button></div>
    ${body}
    <div class="modal-f">${footer}</div>
  </div></div>`;
}
const saveBtn = (action, label) =>
  `<button class="btn btn-primary ${SOC.busy ? 'is-loading' : ''}" data-a="${action}" ${SOC.busy ? 'disabled' : ''}>${label}</button>`;
const cancelBtn = () => `<button class="btn btn-secondary" data-a="socialClose">${tr('Cancel')}</button>`;
const formError = () => (SOC.errors.form ? `<div class="alert danger" role="alert">${ic('circle-alert', 14)}<span>${esc(SOC.errors.form)}</span></div>` : '');

export function dialogHtml() {
  const d = SOC.dialog;
  if (!d) return '';
  if (d.type === 'account') return accountDialog(d);
  if (d.type === 'numbers') return numbersDialog();
  if (d.type === 'csv') return csvDialog();
  return '';
}

function accountDialog(d) {
  const f = SOC.form;
  const brands = [...new Set(SOC.accounts.map(a => a.brand))];
  const body = `<form class="modal-b" data-submit="socialSaveAccount" novalidate>
    ${formError()}
    <div class="field"><label class="label" for="soc-brand">${tr('Brand')}</label>
      <input class="input ${invalid('brand')}" id="soc-brand" data-in="socialForm" data-f="brand" value="${esc(f.brand)}" list="soc-brands" maxlength="80" placeholder="${tr('e.g. My brand')}" autocomplete="off" autofocus aria-invalid="${!!SOC.errors.brand}" aria-describedby="soc-brand-err">
      <datalist id="soc-brands">${brands.map(b => `<option value="${esc(b)}"></option>`).join('')}</datalist>${err('brand', 'soc-brand-err')}
      <span class="hint">${tr('Accounts with the same brand are added together in the totals.')}</span></div>
    <div class="soc-two">
      <div class="field"><label class="label" for="soc-platform">${tr('Network')}</label>
        <select class="select" id="soc-platform" data-in="socialForm" data-f="platform">${PLATFORMS.map(p => option(p.id, platformName(p.id), f.platform)).join('')}</select></div>
      <div class="field"><label class="label" for="soc-handle">${tr('Account')}</label>
        <input class="input ${invalid('handle')}" id="soc-handle" data-in="socialForm" data-f="handle" value="${esc(f.handle)}" maxlength="200" autocomplete="off" autocapitalize="off" spellcheck="false" aria-invalid="${!!SOC.errors.handle}" aria-describedby="soc-handle-err soc-handle-hint">${err('handle', 'soc-handle-err')}</div>
    </div>
    <span class="hint" id="soc-handle-hint" style="margin-top:-8px">${handleHint(f.platform)}</span>
    <div class="field"><label class="label" for="soc-name">${tr('Name shown')} <span class="faint" style="font-weight:400">· ${tr('optional')}</span></label>
      <input class="input" id="soc-name" data-in="socialForm" data-f="display_name" value="${esc(f.display_name)}" maxlength="120" autocomplete="off"></div>
    <div class="field"><label class="label" for="soc-url">${tr('Profile address')} <span class="faint" style="font-weight:400">· ${tr('optional')}</span></label>
      <input class="input ${invalid('url')}" id="soc-url" data-in="socialForm" data-f="url" value="${esc(f.url)}" maxlength="500" inputmode="url" placeholder="https://" autocomplete="off" autocapitalize="off" spellcheck="false" aria-invalid="${!!SOC.errors.url}" aria-describedby="soc-url-err">${err('url', 'soc-url-err')}</div>
    <label class="soc-check"><input type="checkbox" class="check" data-in="socialForm" data-f="is_active" ${f.is_active ? 'checked' : ''}><span>${tr('Include this account in the daily automatic collection')}<span class="hint" style="display:block">${tr('Only networks with a collector configured are collected. The others keep working with the form and CSV.')}</span></span></label>
  </form>`;
  return frame(
    '',
    d.id ? tr('Edit account') : tr('Add account'),
    d.id ? '' : tr('One account per network and brand.'),
    body,
    `<span class="sp"></span>${cancelBtn()}${saveBtn('socialSaveAccount', d.id ? tr('Save changes') : tr('Add account'))}`,
  );
}

function numbersDialog() {
  const f = SOC.form;
  const a = accountById(f.account_id);
  const existing = a && SOC.snapshots.find(s => s.account_id === a.id && s.date === f.date);
  const num = (key, label, id) =>
    `<div class="field"><label class="label" for="${id}">${label}</label><input class="input ${invalid(key)}" id="${id}" data-in="socialForm" data-f="${key}" value="${esc(f[key])}" inputmode="numeric" autocomplete="off" aria-invalid="${!!SOC.errors[key]}" aria-describedby="${id}-err">${err(key, id + '-err')}</div>`;
  const body = `<form class="modal-b" data-submit="socialSaveNumbers" novalidate>
    ${formError()}
    <div class="soc-two">
      <div class="field"><label class="label" for="soc-n-account">${tr('Account')}</label><select class="select" id="soc-n-account" data-in="socialForm" data-f="account_id">${accountOptions(f.account_id)}</select></div>
      <div class="field"><label class="label" for="soc-n-date">${tr('Day')}</label><input class="input ${invalid('date')}" type="date" id="soc-n-date" data-in="socialForm" data-f="date" value="${esc(f.date)}" max="${todayIn()}" aria-invalid="${!!SOC.errors.date}" aria-describedby="soc-n-date-err">${err('date', 'soc-n-date-err')}</div>
    </div>
    ${existing ? `<div class="alert info">${ic('info', 14)}<span>${tr('This day already has numbers for this account. Saving replaces the ones you fill in.')}</span></div>` : ''}
    <div class="field"><label class="label" for="soc-n-followers">${a ? audienceLabel(a.platform) : tr('Followers')}</label>
      <input class="input input-lg ${invalid('followers')}" id="soc-n-followers" data-in="socialForm" data-f="followers" value="${esc(f.followers)}" inputmode="numeric" autocomplete="off" autofocus placeholder="${tr('e.g. 12,345')}" aria-invalid="${!!SOC.errors.followers}" aria-describedby="soc-n-followers-err">${err('followers', 'soc-n-followers-err')}</div>
    <fieldset class="soc-more"><legend class="label">${tr('Other numbers')} <span class="faint" style="font-weight:400">· ${tr('optional')}</span></legend>
      <div class="soc-three">
        ${num('following', tr('Following'), 'soc-n-following')}${num('posts_count', tr('Posts'), 'soc-n-posts')}${num('views', tr('Views|social'), 'soc-n-views')}
        ${num('likes', tr('Likes'), 'soc-n-likes')}${num('comments', tr('Comments'), 'soc-n-comments')}${num('shares', tr('Shares'), 'soc-n-shares')}
      </div>
    </fieldset>
  </form>`;
  return frame(
    '',
    tr('Enter numbers'),
    tr('Type the numbers you see on the network for one day. It works for any network, with or without automatic collection.'),
    body,
    `<span class="sp"></span>${cancelBtn()}${saveBtn('socialSaveNumbers', tr('Save numbers'))}`,
  );
}

/* What went wrong on a line of the file. */
export function csvProblem(e) {
  const v = e.value ? `"${e.value}"` : '';
  switch (e.code) {
    case 'empty':
      return tr('The file is empty.');
    case 'no-date-column':
      return tr('The first line needs a "date" column.');
    case 'no-number-column':
      return tr('The first line needs at least one number column, such as "followers".');
    case 'no-account':
      return tr('Choose the account these numbers belong to, or add "platform" and "handle" columns to the file.');
    case 'bad-date':
      return tr('{value} is not a date. Use 2026-01-31 or 31/01/2026.', { value: v });
    case 'future-date':
      return tr('{value} is in the future.', { value: v });
    case 'unknown-account':
      return tr('No account matches {value}. Add the account first.', { value: v });
    case 'bad-number':
      return tr('{value} is not a number.', { value: v });
    case 'no-numbers':
      return tr('The line has no numbers.');
    default:
      return tr('The line could not be read.');
  }
}
function csvDialog() {
  const f = SOC.form;
  const r = SOC.csv?.result;
  const cols = Object.keys(CSV_COLUMNS)
    .map(c => `<code>${c === 'posts_count' ? 'posts' : c}</code>`)
    .join(', ');
  let preview = '';
  if (SOC.csv?.error) preview = `<div class="alert danger" role="alert">${ic('circle-alert', 14)}<span>${esc(SOC.csv.error)}</span></div>`;
  else if (r) {
    const shown = r.errors.slice(0, 6);
    const head = r.rows.length
      ? `<div class="alert ${r.errors.length ? 'warn' : 'ok'}" role="status">${ic(r.errors.length ? 'triangle-alert' : 'circle-check', 14)}<span><b>${trn('{n} day ready to import', '{n} days ready to import', r.rows.length)}</b>${r.errors.length ? ' · ' + trn('{n} line will be skipped', '{n} lines will be skipped', r.errors.length) : ''}<br><span class="faint">${tr('From {from} to {to}', { from: dateText(r.rows[0].date), to: dateText(r.rows[r.rows.length - 1].date) })}</span></span></div>`
      : `<div class="alert danger" role="alert">${ic('circle-alert', 14)}<span><b>${tr('Nothing to import from this file.')}</b></span></div>`;
    const list = shown.length
      ? `<ul class="soc-problems">${shown.map(e => `<li><span class="faint">${tr('Line {n}', { n: e.line })}</span> ${esc(csvProblem(e))}</li>`).join('')}${r.errors.length > shown.length ? `<li class="faint">${trn('and {n} more line', 'and {n} more lines', r.errors.length - shown.length)}</li>` : ''}</ul>`
      : '';
    preview = head + list;
  }
  const body = `<form class="modal-b" data-submit="socialCsvImport" novalidate>
    ${formError()}
    <div class="field"><label class="label" for="soc-c-account">${tr('Account')}</label>
      <select class="select" id="soc-c-account" data-in="socialCsvAccount">${option('', tr('Taken from the "platform" and "handle" columns'), f.account_id)}${accountOptions(f.account_id)}</select></div>
    <div class="field"><label class="label" for="soc-c-file">${tr('CSV file')}</label>
      <input class="input soc-file" type="file" id="soc-c-file" accept=".csv,.txt,text/csv,text/plain" data-in="socialCsvFile">
      ${SOC.csv?.name ? `<span class="hint">${ic('file-text', 12)} ${esc(SOC.csv.name)}</span>` : ''}</div>
    <div class="field"><label class="label" for="soc-c-text">${tr('Or paste the lines here')}</label>
      <textarea class="input soc-paste" id="soc-c-text" data-in="socialCsvText" rows="4" spellcheck="false" placeholder="date,followers&#10;2026-01-31,12345">${esc(SOC.csv?.name ? '' : SOC.csv?.text || '')}</textarea></div>
    ${preview}
    <div class="hint">${tr('One line per day. The first line names the columns: {cols}. Dates as 2026-01-31 or 31/01/2026. A day that already has numbers is replaced.', { cols })} <button type="button" class="link" data-a="socialCsvTemplate">${tr('Download an example')}</button></div>
  </form>`;
  return frame(
    '',
    tr('Import CSV'),
    tr('Bring the history of any network from a spreadsheet, including Substack and others without automatic collection.'),
    body,
    `<span class="sp"></span>${cancelBtn()}<button class="btn btn-primary ${SOC.busy ? 'is-loading' : ''}" data-a="socialCsvImport" ${SOC.busy || !r?.rows.length ? 'disabled' : ''}>${r?.rows.length ? trn('Import {n} day', 'Import {n} days', r.rows.length) : tr('Import')}</button>`,
  );
}
