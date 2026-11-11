/* ---------- SOCIAL MEDIA · entry ----------
   The page lives in src/social/ and is loaded the first time someone opens it, so the rest of the app does not
   carry it. Until it arrives this module shows the page header over a skeleton. */
import { esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { tr } from '../core/i18n.js';
import { D, S } from '../core/store.js';
import { empty } from '../ui/helpers.js';
import { render } from '../shell/render.js';

let page = null; // the loaded module
let state = 'idle'; // idle | loading | failed
let failedAt = 0;

function load() {
  state = 'loading';
  import('../social/page.js')
    .then(m => {
      page = m;
      state = 'idle';
    })
    .catch(e => {
      console.error(e);
      state = 'failed';
      failedAt = Date.now();
    })
    .finally(() => {
      if (S.ui.route === 'social') render();
    });
}

export function pageSocial() {
  if (page) return page.pageSocial();
  // "Try again" draws the page again: a failure older than a moment is retried
  if (state === 'failed' && Date.now() - failedAt > 800) state = 'idle';
  const head = `<div class="ph"><div><h1>${tr('Social media')}</h1><p>${tr('Audience growth of every brand in {name}.', { name: esc(D().ws.name) })}</p></div></div>`;
  if (state === 'failed')
    return `<div class="page">${head}${empty(
      'circle-alert',
      tr("Couldn't load social media"),
      tr('Check your connection and try again.'),
      `<button class="btn btn-secondary" data-a="go" data-r="social">${ic('refresh-cw', 14)}${tr('Try again')}</button>`,
      'err',
    )}</div>`;
  if (state === 'idle') queueMicrotask(() => state === 'idle' && !page && load());
  return `<div class="page">${head}<div role="status" aria-label="${tr('Loading…')}" style="display:flex;flex-direction:column;gap:16px"><span class="sk" style="height:76px;border-radius:var(--r-lg)"></span><span class="sk" style="height:220px;border-radius:var(--r-lg)"></span></div></div>`;
}
