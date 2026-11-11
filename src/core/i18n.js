/* ---------- i18n ----------
   gettext-style: the English text is the key. `tr('New task')` returns the text in the current language and falls
   back to English when a translation is missing. A key may carry a context after a pipe to tell homographs apart:
   tr('Open|verb') and tr('Open|status') can translate differently, and both read "Open" in English.

   What is stored (activity verbs, notification texts, status and permission values) stays in canonical English and
   is translated where it is displayed, so people using different languages share the same data.

   Leaf module: it imports only dictionaries, so any file can use it. */
import ptBR from '../i18n/pt-BR/index.js';

export const LANGS = [
  { id: 'en', name: 'English' },
  { id: 'pt-BR', name: 'Português (Brasil)' },
];
const DICTS = { 'pt-BR': ptBR };
const CALENDAR = {
  en: {
    mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    monl: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    wdl: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  },
  'pt-BR': {
    mon: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
    monl: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
    wd: ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'],
    wdl: ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'],
  },
};

let lang = 'en';
export const getLang = () => lang;
export const isLang = l => LANGS.some(x => x.id === l);
/* The browser's language decides the first visit; after that the person's choice is kept in their preferences. */
export function detectLang() {
  try {
    const l = String(globalThis.navigator?.languages?.[0] || globalThis.navigator?.language || 'en').toLowerCase();
    return l.startsWith('pt') ? 'pt-BR' : 'en';
  } catch {
    return 'en';
  }
}
export function setLang(l) {
  lang = isLang(l) ? l : 'en';
  try {
    if (globalThis.document?.documentElement) document.documentElement.lang = lang;
  } catch {
    /* no document (tests) */
  }
  return lang;
}

const stripContext = key => {
  const i = key.indexOf('|');
  return i < 0 ? key : key.slice(0, i);
};
const fill = (s, params) => (params ? s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m)) : s);

/* tr('Hello {name}', { name }) */
export function tr(key, params) {
  const hit = lang === 'en' ? undefined : DICTS[lang]?.[key];
  return fill(hit ?? stripContext(key), params);
}
/* trn('{n} task', '{n} tasks', count): picks the singular or plural key and fills {n}. */
export function trn(one, other, n, params) {
  return tr(n === 1 ? one : other, { n, ...params });
}
/* True when the current language has its own text for this key (used to translate stored values only when known). */
export const hasTr = key => lang !== 'en' && Object.prototype.hasOwnProperty.call(DICTS[lang] || {}, key);

/* Calendar names in the current language. The arrays in utils.js (MON, MONL, WD, WDL) stay in English. */
export const monShort = i => CALENDAR[lang].mon[i];
export const monLong = i => CALENDAR[lang].monl[i];
export const wdShort = i => CALENDAR[lang].wd[i];
export const wdLong = i => CALENDAR[lang].wdl[i];
/* "November 2026" / "novembro de 2026" */
export const monthYear = d => (lang === 'pt-BR' ? `${monLong(d.getMonth())} de ${d.getFullYear()}` : `${monLong(d.getMonth())} ${d.getFullYear()}`);
/* "Wednesday, November 11" / "quarta-feira, 11 de novembro" */
export const longDay = d =>
  lang === 'pt-BR' ? `${wdLong(d.getDay())}, ${d.getDate()} de ${monLong(d.getMonth())}` : `${wdLong(d.getDay())}, ${monLong(d.getMonth())} ${d.getDate()}`;
/* "Nov 12" / "12 de nov" (optionally with the year) */
export const shortDay = (d, withYear) =>
  lang === 'pt-BR'
    ? `${d.getDate()} de ${monShort(d.getMonth())}${withYear ? ' de ' + d.getFullYear() : ''}`
    : `${monShort(d.getMonth())} ${d.getDate()}${withYear ? ', ' + d.getFullYear() : ''}`;
