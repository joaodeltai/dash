/* ---------- NOTIFICATIONS ---------- */
import { ago, dayBucket, esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { tr } from '../core/i18n.js';
import { notifSnip } from '../core/activity-text.js';
import { D, S, proj, task } from '../core/store.js';
import { empty, fmtComment } from '../ui/helpers.js';
import { notifIcon, notifText } from './inbox.js';

export function pageNotifications() {
  const f = S.ui.notifFilter;
  let ns = D()
    .notifs.slice()
    .sort((a, b) => b.at - a.at);
  const unread = ns.filter(n => !n.read).length;
  if (f === 'unread') ns = ns.filter(n => !n.read);
  const buckets = {};
  ns.forEach(n => (buckets[dayBucket(n.at)] ||= []).push(n));
  return `<div class="page" style="max-width:820px">
    <div class="ph"><div><h1 class="row" style="gap:10px">${tr('Notifications')} ${unread ? `<span class="badge accent">${tr('{n} unread', { n: unread })}</span>` : ''}</h1><p>${tr('Updates on tasks and projects you follow.')}</p></div>
      <div class="acts"><div class="seg">${[
        ['all', tr('All|notifications')],
        ['unread', tr('Unread')],
      ]
        .map(([k, n]) => `<button class="${f === k ? 'on' : ''}" data-a="set" data-k="notifFilter" data-v="${k}">${n}</button>`)
        .join('')}</div>
      <button class="btn btn-secondary" data-a="markAllRead" ${unread ? '' : 'disabled'}>${ic('check-check', 14)}${tr('Mark all as read')}</button>
      <button class="ibtn" data-a="go" data-r="settings" data-sec="notif-email" data-tip="${tr('Notification preferences')}" aria-label="${tr('Notification preferences')}">${ic('settings-2', 16)}</button></div></div>
    ${
      ns.length
        ? Object.entries(buckets)
            .map(
              ([b, list]) =>
                `<div class="day-h">${tr(b)}</div><div class="panel" style="overflow:hidden">${list
                  .map(n => {
                    const t = n.task ? task(n.task) : null;
                    const p = n.project ? proj(n.project) : t ? proj(t.project) : null;
                    return `<div class="nrow ${n.read ? '' : 'unread'}" data-a="openNotif" data-id="${n.id}" role="button" tabindex="0">
        ${notifIcon(n)}<div class="grow" style="font-size:13px"><div>${notifText(n)}</div><div class="muted trunc" style="font-size:12.5px;margin-top:2px">${fmtComment(notifSnip(n))}</div><div class="faint" style="font-size:11.5px;margin-top:4px">${p ? esc(p.name) + ' · ' : ''}${ago(n.at)}</div></div>
        ${n.read ? '' : '<span style="width:7px;height:7px;border-radius:50%;background:var(--accent);margin-top:8px" aria-label="' + tr('Unread|item') + '"></span>'}
        <button class="ibtn ibtn-sm" data-a="toggleRead" data-id="${n.id}" data-tip="${n.read ? tr('Mark as unread') : tr('Mark as read')}" aria-label="${tr('Toggle read')}">${ic(n.read ? 'mail' : 'check', 14)}</button></div>`;
                  })
                  .join('')}</div>`,
            )
            .join('')
        : `<div class="panel">${empty('bell-off', tr("You're all caught up."), tr("No unread notifications. We'll let you know when something needs you."), `<button class="btn btn-secondary btn-sm" data-a="set" data-k="notifFilter" data-v="all">${tr('Show all')}</button>`)}</div>`
    }
  </div>`;
}
