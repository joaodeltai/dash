/* =====================================================================
   SOCIAL MEDIA · actions: accounts, numbers typed by hand, CSV import
   ===================================================================== */
import { $, $$ } from '../core/utils.js';
import { S } from '../core/store.js';
import { tr, trn } from '../core/i18n.js';
import { toast } from '../ui/toast.js';
import { render } from '../shell/render.js';
import { A, IN, confirmDlg } from '../actions/actions.js';
import { SOC, accountById, deleteAccount, loadSocial, saveAccount, saveSnapshots } from './data.js';
import { canonicalBrand, csvToSnapshots, parseCount, parseCsv, parseDate, todayIn } from './logic.js';
import { platformName } from './platforms.js';

const MAX_CSV_BYTES = 2 * 1024 * 1024;

/* ---------- dialogs ---------- */
export function openDialog(dialog, form = {}) {
  Object.assign(SOC, {
    dialog: { ...dialog, nav: S.ui.history.length, fresh: true, opener: document.activeElement },
    form,
    errors: {},
    csv: null,
    busy: false,
  });
  S.ui.pop = null;
  render();
  setTimeout(() => {
    const box = $('.soc-dialog .modal');
    (box?.querySelector('[autofocus]') || box?.querySelector('input,select,textarea,button'))?.focus();
  }, 30);
}
export function closeDialog() {
  const opener = SOC.dialog?.opener;
  Object.assign(SOC, { dialog: null, form: {}, errors: {}, csv: null, busy: false });
  render();
  // the page was drawn again: find the control that opened the dialog by what it does
  const a = opener?.dataset?.a;
  if (a)
    (
      document.querySelector(`[data-a="${CSS.escape(a)}"]${opener.dataset.id ? `[data-id="${CSS.escape(opener.dataset.id)}"]` : ''}`) || $('.ph [data-a]')
    )?.focus();
}
A.socialClose = () => closeDialog();
A.socialCloseBg = (el, e) => {
  if (e.target === el) closeDialog();
};
/* Escape closes the dialog and Tab stays inside it. The app's own key handling knows nothing about this dialog,
   so this listener runs first and steps aside when an app surface (menu, palette, app modal) is open above it. */
document.addEventListener(
  'keydown',
  e => {
    if (!SOC.dialog || S.ui.route !== 'social' || S.ui.modals.length || S.ui.palette || S.ui.pop || $('.select-menu')) return;
    const box = $('.soc-dialog .modal');
    if (!box) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    } else if (e.key === 'Tab') {
      const f = $$(
        'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        box,
      ).filter(x => x.offsetParent !== null);
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && (i === f.length - 1 || i === -1)) {
        e.preventDefault();
        f[0].focus();
      }
    }
  },
  true,
);

const problem = res =>
  res.code === 'offline'
    ? tr("You're offline. Nothing was saved.")
    : res.code === 'forbidden'
      ? tr("You don't have permission to change this.")
      : tr("That couldn't be saved. Try again in a moment.");
/* Runs a change, then reads the data again. Returns the result of the change. */
async function commit(change) {
  if (SOC.busy) return { ok: false, code: 'busy' };
  SOC.busy = true;
  render();
  const res = await change();
  if (res.ok) await loadSocial({ silent: true });
  SOC.busy = false;
  return res;
}

IN.socialForm = el => {
  const f = el.dataset.f;
  SOC.form[f] = el.type === 'checkbox' ? el.checked : el.value;
  const hadError = !!SOC.errors[f] || !!SOC.errors.form;
  if (hadError) {
    SOC.errors[f] = null;
    SOC.errors.form = null;
  }
  // these change what the dialog shows (hint, label, "already has numbers" notice)
  if (hadError || f === 'platform' || f === 'account_id' || f === 'date') render();
};
A.socialRetry = () => {
  SOC.status = 'idle';
  render();
};

/* ---------- accounts ---------- */
A.socialAdd = () =>
  openDialog(
    { type: 'account' },
    { brand: SOC.filters.brand || '', platform: SOC.filters.platform || 'instagram', handle: '', display_name: '', url: '', is_active: true },
  );
A.socialEdit = el => {
  const a = accountById(el.dataset.id);
  if (!a) return;
  openDialog(
    { type: 'account', id: a.id },
    { brand: a.brand, platform: a.platform, handle: a.handle, display_name: a.display_name, url: a.url, is_active: a.is_active },
  );
};
A.socialSaveAccount = async () => {
  const d = SOC.dialog;
  if (!d || d.type !== 'account' || SOC.busy) return;
  const f = SOC.form;
  const brand = canonicalBrand(f.brand, [...new Set(SOC.accounts.map(a => a.brand))]);
  const handle = String(f.handle || '')
    .trim()
    .replace(/^@+/, '');
  const url = String(f.url || '').trim();
  const errors = {};
  if (!brand) errors.brand = tr('Give the brand a name.');
  if (!handle) errors.handle = tr('Type the account.');
  else if (f.platform === 'website' && !/^\d+$/.test(handle)) errors.handle = tr('For a website this is the GA4 property ID: digits only.');
  if (url && !/^https?:\/\/\S+$/i.test(url)) errors.url = tr('The address must start with https://');
  SOC.errors = errors;
  if (Object.keys(errors).length) {
    render();
    $(errors.brand ? '#soc-brand' : errors.handle ? '#soc-handle' : '#soc-url')?.focus();
    return;
  }
  const res = await commit(() => saveAccount({ ...f, brand, handle, url, display_name: String(f.display_name || '').trim() }, d.id));
  if (res.ok) {
    closeDialog();
    toast(d.id ? tr('Account updated') : tr('{network} account added', { network: platformName(f.platform) }));
    return;
  }
  if (res.code === 'duplicate') SOC.errors = { handle: tr('This account is already on the list.') };
  else SOC.errors = { form: problem(res) };
  render();
};
A.socialRemove = el => {
  const a = accountById(el.dataset.id);
  if (!a) return;
  confirmDlg({
    title: tr('Remove {name}?', { name: a.display_name || a.handle }),
    body: tr('The {network} account and all of its history (numbers, posts and goal) are deleted. This cannot be undone.', {
      network: platformName(a.platform),
    }),
    ok: tr('Remove account'),
    danger: true,
    run: async () => {
      const res = await commit(() => deleteAccount(a.id));
      render();
      toast(res.ok ? tr('Account removed') : problem(res), res.ok ? {} : { kind: 'err' });
    },
  });
};

/* ---------- numbers typed by hand ---------- */
const NUMBER_KEYS = ['followers', 'following', 'posts_count', 'views', 'likes', 'comments', 'shares'];
A.socialNumbers = el => {
  const id = el?.dataset?.id && accountById(el.dataset.id) ? el.dataset.id : SOC.accounts[0]?.id;
  if (!id) return;
  openDialog(
    { type: 'numbers' },
    { account_id: id, date: todayIn(), followers: '', following: '', posts_count: '', views: '', likes: '', comments: '', shares: '' },
  );
};
A.socialSaveNumbers = async () => {
  if (!SOC.dialog || SOC.dialog.type !== 'numbers' || SOC.busy) return;
  const f = SOC.form;
  const a = accountById(f.account_id);
  const errors = {};
  const date = parseDate(f.date);
  if (!date) errors.date = tr('Choose the day.');
  else if (date > todayIn()) errors.date = tr("The day can't be in the future.");
  const row = { account_id: f.account_id, date };
  let filled = 0;
  for (const k of NUMBER_KEYS) {
    const raw = String(f[k] ?? '').trim();
    if (!raw) continue;
    const n = parseCount(raw);
    if (n === null) errors[k] = tr('Type a whole number.');
    else {
      row[k] = n;
      filled++;
    }
  }
  if (!a) errors.form = tr('Choose the account.');
  else if (!filled && !Object.keys(errors).length) errors.followers = tr('Type at least one number.');
  SOC.errors = errors;
  if (Object.keys(errors).length) {
    render();
    $('.soc-dialog .is-error')?.focus();
    return;
  }
  const res = await commit(() => saveSnapshots([row], 'manual'));
  if (res.ok) {
    closeDialog();
    toast(tr('Numbers saved for {name}', { name: a.display_name || a.handle }));
    return;
  }
  SOC.errors = { form: problem(res) };
  render();
};

/* ---------- CSV ---------- */
function readCsv() {
  if (!SOC.csv?.text) return;
  SOC.csv.result = csvToSnapshots(parseCsv(SOC.csv.text), { accounts: SOC.accounts, defaultAccountId: SOC.form.account_id || '' });
}
A.socialCsv = () => openDialog({ type: 'csv' }, { account_id: SOC.accounts.length === 1 ? SOC.accounts[0].id : '' });
IN.socialCsvAccount = el => {
  SOC.form.account_id = el.value;
  SOC.errors = {};
  readCsv();
  render();
};
IN.socialCsvFile = el => {
  const file = el.files?.[0];
  if (!file) return;
  SOC.errors = {};
  if (file.size > MAX_CSV_BYTES) {
    SOC.csv = { name: file.name, text: '', error: tr('The file is larger than 2 MB. Split it and import in parts.') };
    render();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (SOC.dialog?.type !== 'csv') return;
    SOC.csv = { name: file.name, text: String(reader.result || '') };
    readCsv();
    render();
  };
  reader.onerror = () => {
    SOC.csv = { name: file.name, text: '', error: tr("The file couldn't be read.") };
    render();
  };
  reader.readAsText(file);
};
let pasteTimer = 0;
IN.socialCsvText = el => {
  SOC.csv = el.value.trim() ? { name: '', text: el.value } : null;
  SOC.errors = {};
  clearTimeout(pasteTimer);
  pasteTimer = setTimeout(() => {
    readCsv();
    render();
  }, 250);
};
A.socialCsvTemplate = () => {
  const lines = [
    'date,platform,handle,followers,posts,views,likes,comments,shares',
    '2026-01-30,substack,mynewsletter,1180,,,,,',
    '2026-01-31,substack,mynewsletter,1204,,,,,',
    '2026-01-31,instagram,mybrand,12345,210,,,,',
  ];
  const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'social-numbers-example.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
A.socialCsvImport = async () => {
  if (!SOC.dialog || SOC.dialog.type !== 'csv' || SOC.busy) return;
  clearTimeout(pasteTimer);
  readCsv();
  const r = SOC.csv?.result;
  if (!r?.rows.length) {
    render();
    return;
  }
  const n = r.rows.length;
  const accounts = new Set(r.rows.map(x => x.account_id)).size;
  const res = await commit(() => saveSnapshots(r.rows, 'csv'));
  if (res.ok) {
    closeDialog();
    toast(
      accounts > 1
        ? trn('{n} day imported for {accounts} accounts', '{n} days imported for {accounts} accounts', n, { accounts })
        : trn('{n} day imported', '{n} days imported', n),
    );
    return;
  }
  SOC.errors = { form: res.written ? tr('The import stopped part of the way: {n} days were saved. Try again to finish.', { n: res.written }) : problem(res) };
  render();
};
