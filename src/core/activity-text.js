/* ---------- stored text → displayed text ----------
   Activity entries and notifications are stored once, in English, and read by people using different languages.
   These helpers turn the stored pieces into text for the current language. They return plain text: escape it
   where it is put into HTML. */
import { getLang, hasTr, tr } from './i18n.js';
import { MON, fmtDate, iso } from './utils.js';

const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/g;
/* Dates older entries stored already formatted in English ("Nov 12" or "Nov 12, 2026"). */
const EN_DATE = /^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?$/;

/* A stored vocabulary word (status, priority, …) in the current language; anything else is returned as is. */
const known = s => (hasTr(s) ? tr(s) : s);
function dateOrText(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtDate(s);
  const m = EN_DATE.exec(s);
  if (m && MON.includes(m[1])) return fmtDate(iso(new Date(m[3] ? +m[3] : new Date().getFullYear(), MON.indexOf(m[1]), +m[2])));
  return s;
}

/* The verb of an activity entry: "created", "moved", "changed due date of"… */
export const actVerb = a => tr(a.verb || '');

/* The detail that follows the object of an activity entry: "from To Do to Done", "to Ana", "(cleared)"… */
export function actExtra(a) {
  const x = a.extra || '';
  if (!x) return '';
  const verb = a.verb || '';
  if (x === '(unassigned)' || x === '(cleared)') return tr(x);
  let m;
  if (verb === 'moved' && (m = /^from (.+) to (.+)$/.exec(x))) return tr('from {a} to {b}', { a: known(m[1]), b: known(m[2]) });
  if (verb === 'set repeat on') {
    if (x === 'off') return tr('off|repeat');
    const cap = x.charAt(0).toUpperCase() + x.slice(1);
    return hasTr(cap) ? tr(cap).toLowerCase() : x;
  }
  if (verb === 'estimated') return x === 'none' ? tr('none|estimate') : x;
  if (verb === 'set a subtask due date on') return dateOrText(x);
  if ((m = /^to (.+)$/.exec(x))) {
    if (verb === 'assigned' || verb === 'assigned a subtask on') return tr('to {x}|person', { x: m[1] });
    if (verb === 'changed due date of' || verb === 'changed start date of') return tr('to {x}', { x: dateOrText(m[1]) });
    if (verb === 'changed priority of' || verb === 'changed status of project') return tr('to {x}', { x: known(m[1]) });
    return tr('to {x}', { x: m[1] }); // a project name or a new title: the person's own words
  }
  if ((m = /^into (.+)$/.exec(x))) return tr('into {x}', { x: m[1] });
  return getLang() === 'en' ? x.replace(ISO_DATE, d => fmtDate(d)) : x;
}

/* The verb of a notification, written by a database trigger: "assigned you", "moved to In Progress"… */
export function notifVerb(n) {
  const x = n.text || '';
  const m = /^moved to (.+)$/.exec(x);
  if (m) return tr('moved to {status}', { status: known(m[1]) });
  return tr(x);
}

/* The second line of a notification. Comment text and task titles are the person's own words and are left alone. */
export function notifSnip(n) {
  const x = n.snippet || '';
  if (getLang() === 'en') return x;
  let m;
  if (n.type === 'assign' && (m = /^(?:Due ([A-Z][a-z]{2}) (\d{1,2})|No due date) · (\w+) priority$/.exec(x))) {
    const due = m[1] && MON.includes(m[1]) ? tr('Due {date}', { date: dateOrText(`${m[1]} ${m[2]}`) }) : tr('No due date');
    const prio = m[3] === 'None' ? tr('No priority') : tr('{priority} priority', { priority: known(m[3]).toLowerCase() });
    return `${due} · ${prio}`;
  }
  if (n.type === 'update' && (m = /^(.+) → (.+)$/.exec(x)) && hasTr(m[1]) && hasTr(m[2])) return `${tr(m[1])} → ${tr(m[2])}`;
  return x;
}
