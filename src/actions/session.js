/* =====================================================================
   SESSION ACTIONS: sign-in, sign-up, password recovery, onboarding,
   workspaces. Everything here talks to the backend (Supabase).
   ===================================================================== */
import { $, $$, uid, unaccent } from '../core/utils.js';
import { isLang, tr } from '../core/i18n.js';
import { TEAMS_SEED } from '../core/constants.js';
import { D, S, cachePrefs, me, save } from '../core/store.js';
import { applyPrefs } from '../core/theme.js';
import { mutate, toast } from '../ui/toast.js';
import { go, render } from '../shell/render.js';
import { TEMPLATES } from '../overlays/modals.js';
import { A, EMAIL_RE, IN, confirmDlg, copy, createProject } from './actions.js';
import * as backend from '../data/backend.js';

const pwRule = () => tr('Use at least 10 characters, including a number or symbol');
const weak = pw => pw.length < 10 || !/[0-9\W]/.test(pw);

/* Runs an async action behind a button: shows its spinner and ignores repeated clicks while it is in flight. */
let inFlight = false;
async function run(btnId, fn) {
  if (inFlight) return;
  inFlight = true;
  const b = document.getElementById(btnId);
  if (b) {
    b.classList.add('is-loading');
    b.setAttribute('aria-busy', 'true');
  }
  try {
    await fn();
  } finally {
    inFlight = false;
    const again = document.getElementById(btnId);
    if (again) {
      again.classList.remove('is-loading');
      again.removeAttribute('aria-busy');
    }
  }
}
const say = err => toast(err?.message || tr('Something went wrong. Try again.'), { kind: 'err', ms: 6000 });
/* Back to an auth screen after a failed attempt that had already shown the loading splash. */
function backToAuth(screen) {
  S.ui.booting = false;
  S.ui.auth = screen;
  render();
}

/* ---------- screens ---------- */
A.auth = el => {
  S.ui.auth = el.dataset.v;
  S.ui.errors = {};
  S.ui.pwNew = '';
  render();
  setTimeout(() => $('.auth input')?.focus(), 20);
};
/* Language switch of the sign-in screens (and anywhere else the choice is made outside Settings). */
A.setLang = el => {
  const v = el.dataset.v;
  if (!isLang(v)) return;
  // the screen is rebuilt in the new language: keep whatever was typed in its fields
  const typed = $$('.auth input[id]').map(i => [i.id, i.value]);
  S.prefs.lang = v;
  cachePrefs();
  applyPrefs();
  if (backend.ctx.wsId) save();
  render();
  for (const [id, val] of typed) {
    const i = document.getElementById(id);
    if (i && val && !i.value) i.value = val;
  }
};
A.toggleShowPw = () => {
  const v = $('#l-pw')?.value;
  S.ui.showPw = !S.ui.showPw;
  render();
  const i = $('#l-pw');
  if (i) {
    i.value = v;
    i.focus();
  }
};

/* ---------- sign in ---------- */
A.doLogin = () => {
  const e = (S.ui.errors = {});
  const em = $('#l-email').value.trim(),
    pw = $('#l-pw').value;
  S.ui.af.email = em;
  if (!em) e.email = tr('Enter your email address');
  else if (!EMAIL_RE.test(em)) e.email = tr('Enter a valid email, like name@company.com');
  if (!pw) e.pw = tr('Enter your password');
  if (Object.keys(e).length) {
    render();
    (e.email ? $('#l-email') : $('#l-pw'))?.focus();
    if (!e.email) $('#l-pw').value = pw;
    return;
  }
  return run('login-btn', async () => {
    try {
      await backend.signIn(em, pw);
      toast(tr('Signed in as {email}', { email: em }));
    } catch (err) {
      if (err.code === 'EMAIL_NOT_CONFIRMED') {
        backToAuth('verify');
        toast(tr('Confirm your email address to finish signing in.'), { kind: 'info', ms: 6000 });
        return;
      }
      S.ui.errors = { login: err.message || tr('Could not sign in. Try again.') };
      backToAuth('login');
      $('#l-pw')?.focus();
    }
  });
};

const PROVIDER = { Google: 'google', Microsoft: 'azure', Apple: 'apple' };
A.socialAuth = el => {
  const provider = PROVIDER[el.dataset.v];
  if (!provider) return;
  el.classList.add('is-loading');
  backend.signInWithProvider(provider).catch(err => {
    el.classList.remove('is-loading');
    say(err);
  });
};

/* ---------- sign up + email verification ---------- */
A.doSignup = () => {
  const e = (S.ui.errors = {});
  const nm = $('#s-name').value.trim(),
    em = $('#s-email').value.trim(),
    pw = $('#s-pw').value;
  S.ui.af.name = nm;
  S.ui.af.email = em;
  if (!nm) e.name = tr('Enter your name');
  if (!EMAIL_RE.test(em)) e.email = tr('Enter a valid email address');
  if (weak(pw)) e.pw = pwRule();
  if (Object.keys(e).length) {
    render();
    $('#s-email').value = em;
    return;
  }
  return run('signup-btn', async () => {
    try {
      const { needsVerification } = await backend.signUp(nm, em, pw);
      S.ui.pwNew = '';
      if (needsVerification) {
        S.ui.auth = 'verify';
        startResend();
        render();
      } else toast(tr('Welcome, {name}', { name: nm.split(' ')[0] }));
    } catch (err) {
      S.ui.booting = false;
      S.ui.auth = 'signup';
      if (err.code === 'USER_EXISTS') S.ui.errors = { email: err.message };
      else if (err.code === 'WEAK_PASSWORD') S.ui.errors = { pw: err.message };
      else say(err);
      render();
      const i = $('#s-email');
      if (i) i.value = em;
    }
  });
};
export function startResend() {
  S.ui.resendT = 30;
  clearInterval(startResend._i);
  startResend._i = setInterval(() => {
    S.ui.resendT--;
    const el = $('#resend-t');
    if (el) el.textContent = S.ui.resendT;
    if (S.ui.resendT <= 0) {
      clearInterval(startResend._i);
      if (S.ui.auth === 'verify') render();
    }
  }, 1000);
}
A.resend = el => {
  const email = S.ui.af.email;
  const isVerify = el.dataset.v === 'verify';
  (isVerify ? backend.resendVerification(email) : backend.sendPasswordReset(email)).then(() => {
    if (isVerify) {
      startResend();
      render();
    }
    toast(isVerify ? tr('Verification email sent to {email}', { email }) : tr('Reset link sent to {email}', { email }));
  }, say);
};
A.verified = () =>
  run('verified-btn', async () => {
    try {
      await backend.completeVerification();
    } catch (err) {
      if (err.code === 'NEEDS_LOGIN') {
        S.ui.errors = {};
        backToAuth('login');
        toast(tr('Email confirmed? Sign in to continue.'), { kind: 'info' });
      } else if (err.code === 'EMAIL_NOT_CONFIRMED') {
        backToAuth('verify');
        toast(tr("We haven't seen the confirmation yet. Open the link in the email first."), { kind: 'info', ms: 6000 });
      } else {
        backToAuth('verify');
        say(err);
      }
    }
  });

/* ---------- password recovery ---------- */
A.doForgot = () => {
  const em = $('#f-email').value.trim();
  S.ui.af.email = em;
  S.ui.errors = {};
  if (!EMAIL_RE.test(em)) {
    S.ui.errors.email = tr('Enter the email you use to sign in');
    render();
    return;
  }
  return run('forgot-btn', async () => {
    try {
      await backend.sendPasswordReset(em);
      S.ui.auth = 'forgot-sent';
      render();
    } catch (err) {
      say(err);
    }
  });
};
A.doReset = () => {
  const a = $('#r-pw').value,
    b = $('#r-pw2').value;
  const e = (S.ui.errors = {});
  if (weak(a)) e.pw = pwRule();
  if (a !== b) e.pw2 = tr("Passwords don't match");
  if (Object.keys(e).length) {
    render();
    return;
  }
  return run('reset-btn', async () => {
    try {
      await backend.updatePassword(a);
      S.ui.auth = 'reset-done';
      S.ui.pwNew = '';
      render();
    } catch (err) {
      S.ui.errors = { pw: err.message };
      render();
    }
  });
};
A.afterReset = () => run('after-reset-btn', () => backend.continueAfterReset().catch(say));

A.signOut = () => {
  S.ui.pop = null;
  S.ui.palette = null;
  S.ui.drawer = null;
  S.ui.modals = [];
  S.ui.errors = {};
  S.ui.booting = true;
  render();
  backend.signOut().catch(err => {
    S.ui.booting = false;
    render();
    say(err);
  });
};

/* ---------- onboarding ---------- */
A.onbSet = el => {
  S.ui.onbData[el.dataset.k] = el.dataset.v;
  if (el.dataset.k === 'tmpl') {
    const t = TEMPLATES.find(x => x.id === el.dataset.v);
    if (t && !S.ui.onbData.projTouched) S.ui.onbData.proj = t.name === 'Website' ? tr('Website Launch') : tr(t.name);
  }
  render();
};
/* Asks the server whether the workspace handle is free (debounced while typing). */
let slugTimer = null;
function checkSlug() {
  const o = S.ui.onbData;
  o.urlOk = null;
  clearTimeout(slugTimer);
  if (!o.url) return;
  const asked = o.url;
  slugTimer = setTimeout(() => {
    backend.slugAvailable(asked).then(
      ok => {
        if (S.ui.onbData.url !== asked || S.ui.auth !== 'onboarding') return;
        S.ui.onbData.urlOk = !!ok;
        render();
      },
      () => {},
    );
  }, 350);
}
IN.onbWs = el => {
  const o = S.ui.onbData;
  o.ws = el.value;
  if (!o.urlTouched)
    o.url = unaccent(el.value)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  if (S.ui.errors.ws && el.value.trim()) S.ui.errors.ws = null;
  checkSlug();
  render();
};
IN.onbUrl = el => {
  S.ui.onbData.url = unaccent(el.value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-');
  S.ui.onbData.urlTouched = true;
  checkSlug();
  render();
};
IN.onbProj = el => {
  S.ui.onbData.proj = el.value;
  S.ui.onbData.projTouched = true;
};
IN.onbInv = el => {
  const a = (S.ui.onbData.invites || '').split(',');
  a[+el.dataset.i] = el.value.trim();
  S.ui.onbData.invites = a.join(',');
};
A.onbBack = () => {
  S.ui.onb = Math.max(0, S.ui.onb - 1);
  render();
};
A.onbNext = el => {
  const o = S.ui.onbData;
  if (S.ui.onb === 1 && !o.ws.trim()) {
    S.ui.errors.ws = tr('Name your workspace to continue');
    render();
    $('#o-ws')?.focus();
    return;
  }
  if (S.ui.onb === 3 && !o.proj.trim()) {
    toast(tr('Give your project a name'), { kind: 'err' });
    return;
  }
  if (S.ui.onb === 4 && el.dataset.skip) o.invites = '';
  if (S.ui.onb === 4 && !el.dataset.skip) {
    const bad = (o.invites || '').split(',').filter(x => x && !EMAIL_RE.test(x));
    if (bad.length) {
      toast(tr("{email} isn't a valid email address", { email: bad[0] }), { kind: 'err' });
      return;
    }
  }
  S.ui.onb++;
  render();
  setTimeout(() => $('.auth input')?.focus(), 20);
};
/* Leaving setup: back to the open workspace if there is one, otherwise there is nothing to show, so sign out. */
A.onbExit = () => {
  if (backend.ctx.wsId) {
    S.ui.auth = null;
    render();
  } else A.signOut();
};
const TEAM_FOR_USE = { product: 'product', design: 'design', marketing: 'mkt', engineering: 'eng' };
A.onbFinish = () =>
  run('onb-finish', async () => {
    const o = S.ui.onbData;
    const name = o.ws.trim() || tr('My Workspace');
    const color = ['#2F2E2A', '#5A67D8', '#23918A', '#C54B78'][backend.ctx.workspaces.length % 4];
    try {
      await backend.createWorkspace({ name, slug: o.url, color });
    } catch (err) {
      S.ui.booting = false;
      S.ui.loading = false;
      S.ui.auth = 'onboarding';
      render();
      say(err);
      return;
    }
    // The new, empty workspace is now open: fill it with what was chosen during setup.
    let p;
    mutate(() => {
      S.prefs.defaultTab = { kanban: 'board', list: 'list', timeline: 'timeline', table: 'table' }[o.team] || 'board';
      if (o.size !== 'Just me') {
        const ids = {};
        for (const t of TEAMS_SEED) {
          ids[t.id] = uid('tm');
          D().teams.push({ ...t, id: ids[t.id] });
        }
        me().team = ids[TEAM_FOR_USE[o.use]] || '';
      }
      const tm = TEMPLATES.find(t => t.id === o.tmpl) || TEMPLATES[2];
      p = createProject(
        {
          name: o.proj.trim() || tr(tm.name),
          icon: tm.icon === 'file' ? 'folder' : tm.icon,
          color: 'indigo',
          team: me().team,
          lead: D().me,
          desc: tr('Created during setup from the {name} template.', { name: tr(tm.name) }),
        },
        tm.id,
      );
      const seen = new Set(D().members.map(m => m.email.toLowerCase()));
      (o.invites || '')
        .split(',')
        .map(x => x.trim().toLowerCase())
        .filter(x => EMAIL_RE.test(x) && !seen.has(x) && seen.add(x))
        .forEach(e =>
          D().members.push({
            id: uid('m'),
            name: e.split('@')[0].replace(/\b\w/g, c => c.toUpperCase()),
            email: e,
            role: 'Member',
            team: me().team,
            title: tr('Member'),
            c: '#6B7280',
            status: 'invited',
            last: null,
            tz: '—',
          }),
        );
    });
    Object.assign(S.ui.onbData, { ws: '', url: '', urlOk: null, urlTouched: false, invites: '', projTouched: false });
    S.ui.auth = null;
    go('project', { id: p.id, tab: S.prefs.defaultTab });
    toast(tr('Welcome to {name}', { name: D().ws.name }));
  });

/* ---------- workspaces ---------- */
A.switchWs = el => {
  const id = el.dataset.v;
  S.ui.pop = null;
  if (id === backend.ctx.wsId) return render();
  backend.switchWorkspace(id).then(
    () => toast(tr('Switched to {name}', { name: D().ws.name })),
    err => {
      S.ui.loading = false;
      render();
      say(err);
    },
  );
};
A.newWorkspace = () => {
  S.ui.pop = null;
  S.ui.auth = 'onboarding';
  S.ui.onb = 1;
  Object.assign(S.ui.onbData, { ws: '', url: '', urlOk: null, urlTouched: false });
  render();
};
A.saveWorkspace = () => {
  const n = $('#ws-name').value.trim();
  const u = unaccent($('#ws-url').value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!n) {
    toast(tr("Workspace name can't be empty"), { kind: 'err' });
    return;
  }
  return run('ws-save', async () => {
    try {
      if (u && u !== D().ws.url && !(await backend.slugAvailable(u))) {
        toast(tr('“{handle}” is already used by another workspace', { handle: u }), { kind: 'err' });
        return;
      }
      if (
        mutate(() => {
          D().ws.name = n;
          D().ws.url = u || D().ws.url;
          const w = D().workspaces.find(x => x.id === D().ws.id);
          if (w) w.name = n;
        })
      )
        toast(tr('Workspace settings saved'));
    } catch (err) {
      say(err);
    }
  });
};
A.delWorkspace = () =>
  confirmDlg({
    title: tr('Delete {name}?', { name: D().ws.name }),
    body: tr('Every project, task, file, and comment in this workspace will be permanently deleted for all members. This cannot be undone.'),
    ok: tr('Delete workspace'),
    danger: true,
    typeName: D().ws.name,
    run: () => {
      const name = D().ws.name;
      S.ui.loading = true;
      render();
      backend.deleteWorkspace().then(
        () => toast(tr('{name} was deleted', { name }), { kind: 'info', ms: 5000 }),
        err => {
          S.ui.loading = false;
          render();
          toast(tr("Couldn't delete the workspace. {reason}", { reason: backend.friendly(err) }), { kind: 'err', ms: 6000 });
        },
      );
    },
  });
A.copyInviteLink = () => copy(`${location.origin}${location.pathname}#signup`, tr('Sign-up link copied'));

/* ---------- connection ---------- */
A.retryOnline = el => {
  el.classList.add('is-loading');
  backend.retryConnection().then(ok => {
    el.classList.remove('is-loading');
    if (ok) toast(tr('Reconnected. All changes are saved.'));
    else toast(tr("Still can't reach the server."), { kind: 'err' });
  });
};
A.retryBoot = () => location.reload();

/* ---------- password + sessions (settings) ---------- */
A.savePassword = () => {
  const e = (S.ui.errors = {});
  const cur = $('#pw-cur').value,
    nw = $('#pw-new').value,
    cf = $('#pw-conf').value;
  S.ui.pwDone = false;
  if (!cur) e.pwCur = tr('Enter your current password');
  if (weak(nw)) e.pwNew = pwRule();
  if (nw !== cf) e.pwConf = tr("Passwords don't match");
  if (Object.keys(e).length) {
    render();
    return;
  }
  return run('pw-save', async () => {
    try {
      await backend.changePassword(cur, nw);
      S.ui.pwDone = true;
      S.ui.pwNew = '';
      render();
      toast(tr('Password updated'));
    } catch (err) {
      S.ui.errors = err.code === 'INVALID_CREDENTIALS' ? { pwCur: err.message } : { pwNew: err.message };
      render();
    }
  });
};
A.revokeAll = () =>
  confirmDlg({
    title: tr('Sign out of all other sessions?'),
    body: tr("You'll stay signed in on this device. Other browsers and devices will need to sign in again."),
    ok: tr('Sign out others'),
    danger: true,
    icon: 'log-out',
    run: () => backend.signOutOtherSessions().then(() => toast(tr('Signed out of other sessions')), say),
  });
