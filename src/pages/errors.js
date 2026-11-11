/* ---------- 404 / DENIED / FAILED ---------- */
import { esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { mem } from '../core/store.js';
import { tr } from '../core/i18n.js';

export function page404() {
  return `<div class="fullstate"><div class="box"><div class="empty-state" style="padding:0"><div class="glyph">${ic('file-question', 20)}</div></div><span class="code">${tr('ERROR 404')}</span><h1>${tr('Page not found')}</h1><p>${tr("The page you're looking for was moved, deleted, or never existed. Check the link or head back home.")}</p><div class="row"><button class="btn btn-secondary" data-a="back">${ic('arrow-left', 14)}${tr('Go back')}</button><button class="btn btn-primary" data-a="go" data-r="home">${tr('Go to Home')}</button></div></div></div>`;
}
export function stateDenied(p) {
  const lead = mem(p?.lead);
  return `<div class="fullstate"><div class="box"><div class="empty-state" style="padding:0"><div class="glyph">${ic('lock', 20)}</div></div><span class="code">${tr('ERROR 403')}</span><h1>${tr("You don't have access")}</h1><p>${p ? `${tr('{name} is a private project.', { name: `<b>${esc(p.name)}</b>` })} ` : ''}${lead ? tr("Ask {who} to add you, or request access and we'll let them know.", { who: esc(lead.name) }) : tr("Ask the project owner to add you, or request access and we'll let them know.")}</p><div class="row"><button class="btn btn-secondary" data-a="go" data-r="projects">${tr('Back to projects')}</button><button class="btn btn-primary" data-a="requestAccess" data-id="${p?.id || ''}">${tr('Request access')}</button></div></div></div>`;
}
export function stateFailed() {
  return `<div class="fullstate"><div class="box"><div class="empty-state err" style="padding:0"><div class="glyph">${ic('cloud-alert', 20)}</div></div><h1>${tr('Something went wrong.')}</h1><p>${tr('This page failed to load. Your data is safe — try again in a moment.')}</p><div class="row"><button class="btn btn-secondary" data-a="go" data-r="home">${tr('Go to Home')}</button><button class="btn btn-primary" data-a="reload">${ic('refresh-cw', 14)}${tr('Try again')}</button></div></div></div>`;
}
