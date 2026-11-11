import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LANGS, detectLang, getLang, hasTr, isLang, longDay, monthYear, setLang, shortDay, tr, trn, wdShort } from '../../src/core/i18n.js';
import { actExtra, actVerb, notifSnip, notifVerb } from '../../src/core/activity-text.js';
import { ago, fmtDate, relDate, iso, addD, TODAY } from '../../src/core/utils.js';
import { LABELS, PRIOS, PSTAT, ROLES, STATUSES } from '../../src/core/constants.js';
import ptBR from '../../src/i18n/pt-BR/index.js';

afterEach(() => setLang('en'));

describe('tr', () => {
  it('returns the English text when the language is English', () => {
    setLang('en');
    expect(tr('New task')).toBe('New task');
    expect(tr('Hello {name}', { name: 'Ana' })).toBe('Hello Ana');
  });

  it('returns the Portuguese text when the language is pt-BR', () => {
    setLang('pt-BR');
    expect(tr('New task')).toBe('Nova tarefa');
    expect(tr('Cancel')).toBe('Cancelar');
  });

  it('falls back to English for a key that has no translation', () => {
    setLang('pt-BR');
    expect(tr('A sentence nobody translated')).toBe('A sentence nobody translated');
  });

  it('a context after the pipe is part of the key and never shown', () => {
    setLang('en');
    expect(tr('to {x}|person', { x: 'Ana' })).toBe('to Ana');
    setLang('pt-BR');
    expect(tr('to {x}|person', { x: 'Ana' })).toBe('a Ana');
    expect(tr('to {x}', { x: 'Alta' })).toBe('para Alta');
    expect(tr('Unknown thing|some context')).toBe('Unknown thing');
  });

  it('leaves unknown placeholders alone and stringifies values', () => {
    expect(tr('{n} of {total}', { n: 2 })).toBe('2 of {total}');
  });

  it('trn picks singular or plural and fills {n}', () => {
    expect(trn('{n} task', '{n} tasks', 1)).toBe('1 task');
    expect(trn('{n} task', '{n} tasks', 0)).toBe('0 tasks');
    setLang('pt-BR');
    expect(trn('{n} task', '{n} tasks', 1)).toBe('1 tarefa');
    expect(trn('{n} task', '{n} tasks', 3)).toBe('3 tarefas');
  });

  it('only known languages are accepted', () => {
    expect(LANGS.map(l => l.id)).toEqual(['en', 'pt-BR']);
    expect(isLang('pt-BR')).toBe(true);
    expect(isLang('English (US)')).toBe(false);
    expect(setLang('fr')).toBe('en');
    expect(getLang()).toBe('en');
    expect(['en', 'pt-BR']).toContain(detectLang());
  });

  it('hasTr tells whether a stored word has its own text in the current language', () => {
    expect(hasTr('In Progress')).toBe(false); // English needs no dictionary
    setLang('pt-BR');
    expect(hasTr('In Progress')).toBe(true);
    expect(hasTr('Ana Souza')).toBe(false);
  });
});

describe('dates', () => {
  const d = new Date(2026, 10, 11); // Wednesday, November 11, 2026

  it('English', () => {
    expect(shortDay(d)).toBe('Nov 11');
    expect(shortDay(d, true)).toBe('Nov 11, 2026');
    expect(monthYear(d)).toBe('November 2026');
    expect(longDay(d)).toBe('Wednesday, November 11');
    expect(wdShort(3)).toBe('Wed');
  });

  it('Portuguese', () => {
    setLang('pt-BR');
    expect(shortDay(d)).toBe('11 de nov');
    expect(shortDay(d, true)).toBe('11 de nov de 2026');
    expect(monthYear(d)).toBe('novembro de 2026');
    expect(longDay(d)).toBe('quarta-feira, 11 de novembro');
    expect(wdShort(3)).toBe('qua');
  });

  it('relative dates and "ago" follow the language', () => {
    expect(relDate(iso(TODAY))).toBe('Today');
    expect(relDate(iso(addD(TODAY, 1)))).toBe('Tomorrow');
    expect(ago(Date.now() - 5 * 60000)).toBe('5m ago');
    setLang('pt-BR');
    expect(relDate(iso(TODAY))).toBe('Hoje');
    expect(relDate(iso(addD(TODAY, -1)))).toBe('Ontem');
    expect(ago(Date.now() - 5 * 60000)).toBe('há 5 min');
    expect(ago(Date.now())).toBe('agora');
    expect(fmtDate('2031-03-05')).toBe('5 de mar de 2031');
  });
});

describe('stored activity and notification text', () => {
  const a = (verb, extra = '') => ({ verb, extra });

  it('is shown as stored in English, with ISO dates formatted', () => {
    expect(actVerb(a('changed due date of'))).toBe('changed due date of');
    expect(actExtra(a('moved', 'from To Do to Done'))).toBe('from To Do to Done');
    expect(actExtra(a('changed due date of', 'to 2031-03-05'))).toBe('to Mar 5, 2031');
    expect(actExtra(a('assigned', 'to Ana Souza'))).toBe('to Ana Souza');
    expect(actExtra(a('created'))).toBe('');
  });

  it('is translated for a Portuguese reader', () => {
    setLang('pt-BR');
    expect(actVerb(a('created'))).toBe('criou');
    expect(actVerb(a('deleted project'))).toBe('excluiu o projeto');
    expect(actExtra(a('moved', 'from To Do to In Progress'))).toBe('de A fazer para Em andamento');
    expect(actExtra(a('moved', 'to Website'))).toBe('para Website'); // a project name stays as written
    expect(actExtra(a('assigned', 'to Ana Souza'))).toBe('a Ana Souza');
    expect(actExtra(a('assigned', '(unassigned)'))).toBe('(sem responsável)');
    expect(actExtra(a('changed priority of', 'to High'))).toBe('para Alta');
    expect(actExtra(a('changed due date of', 'to 2031-03-05'))).toBe('para 5 de mar de 2031');
    expect(actExtra(a('changed due date of', 'to Mar 5, 2031'))).toBe('para 5 de mar de 2031'); // entries stored before ISO dates
    expect(actExtra(a('changed due date of', '(cleared)'))).toBe('(removido)');
    expect(actExtra(a('set repeat on', 'weekly'))).toBe('semanalmente');
    expect(actExtra(a('set repeat on', 'off'))).toBe('desativada');
    expect(actExtra(a('estimated', 'none'))).toBe('sem estimativa');
    expect(actExtra(a('estimated', '3h'))).toBe('3h');
    expect(actExtra(a('renamed', 'to “Novo título”'))).toBe('para “Novo título”');
    expect(actExtra(a('converted a subtask of', 'into WEB-204'))).toBe('em WEB-204');
    expect(actExtra(a('deleted', 'WEB-201'))).toBe('WEB-201');
  });

  it('every verb the app or the database writes has a Portuguese text', () => {
    setLang('pt-BR');
    const verbs = [
      'created',
      'completed',
      'moved',
      'assigned',
      'changed priority of',
      'changed due date of',
      'changed start date of',
      'updated labels on',
      'renamed',
      'set repeat on',
      'estimated',
      'updated dependencies of',
      'archived',
      'restored',
      'removed a file from',
      'added a file to',
      'completed subtask on',
      'reopened subtask on',
      'added subtask to',
      'assigned a subtask on',
      'set a subtask due date on',
      'commented on',
      'converted a subtask of',
      'deleted',
      'deleted project',
    ];
    for (const v of verbs) expect(hasTr(v), v).toBe(true);
  });

  it('notifications written by the database triggers', () => {
    const assign = { type: 'assign', text: 'assigned you', snippet: 'Due Nov 12 · High priority' };
    const moved = { type: 'update', text: 'moved to In Progress', snippet: 'To Do → In Progress' };
    const comment = { type: 'comment', text: 'commented on', snippet: 'Looks good to me' };
    expect(notifVerb(assign)).toBe('assigned you');
    expect(notifSnip(assign)).toBe('Due Nov 12 · High priority');
    setLang('pt-BR');
    expect(notifVerb(assign)).toBe('atribuiu a você');
    expect(notifSnip(assign)).toBe('Prazo: 12 de nov · Prioridade alta');
    expect(notifSnip({ type: 'assign', snippet: 'No due date · None priority' })).toBe('Sem prazo · Sem prioridade');
    expect(notifVerb(moved)).toBe('moveu para Em andamento');
    expect(notifSnip(moved)).toBe('A fazer → Em andamento');
    expect(notifVerb(comment)).toBe('comentou em');
    expect(notifSnip(comment)).toBe('Looks good to me'); // the person's own words
  });
});

describe('pt-BR dictionary', () => {
  const root = path.resolve(import.meta.dirname, '../../src');
  const walk = dir =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'i18n' ? [] : walk(p);
      return p.endsWith('.js') ? [p] : [];
    });
  const LIT = `'((?:[^'\\\\\\n]|\\\\.)*)'|"((?:[^"\\\\\\n]|\\\\.)*)"|\`((?:[^\`\\\\$]|\\\\.)*)\``;
  const reTr = new RegExp(`\\btr\\(\\s*(?:${LIT})`, 'g');
  const reTrn = new RegExp(`\\btrn\\(\\s*(?:${LIT})\\s*,\\s*(?:${LIT})`, 'g');
  const un = (s, q) => s.replace(new RegExp('\\\\' + q, 'g'), q).replace(/\\\\/g, '\\');
  const pick = (m, i) => (m[i] != null ? un(m[i], "'") : m[i + 1] != null ? un(m[i + 1], '"') : m[i + 2] != null ? un(m[i + 2], '`') : null);

  it('has a text for every literal key used in the source', () => {
    const missing = [];
    for (const file of walk(root)) {
      if (file.endsWith(path.join('core', 'i18n.js'))) continue; // its comments show example calls
      const src = fs.readFileSync(file, 'utf8');
      const keys = new Set();
      for (const m of src.matchAll(reTr)) keys.add(pick(m, 1));
      for (const m of src.matchAll(reTrn)) {
        keys.add(pick(m, 1));
        keys.add(pick(m, 4));
      }
      keys.delete(null);
      for (const k of keys) if (!Object.prototype.hasOwnProperty.call(ptBR, k)) missing.push(`${path.relative(root, file)}: ${k}`);
    }
    expect(missing).toEqual([]);
  });

  it('keeps every {placeholder} of the English key in the Portuguese text', () => {
    const broken = [];
    for (const [key, text] of Object.entries(ptBR)) {
      const want = [...key.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
      const got = [...String(text).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
      // a Portuguese sentence may drop {n} when it reads the same for any count, but may not invent a placeholder
      if (got.some(p => !want.includes(p)) || want.some(p => p !== 'n' && !got.includes(p))) broken.push(key);
    }
    expect(broken).toEqual([]);
  });

  it('covers the stored vocabulary: statuses, priorities, project statuses, labels, roles, permissions, recurrence', () => {
    const words = [
      ...STATUSES.map(s => s.name),
      ...PRIOS.map(p => p.name),
      ...Object.values(PSTAT).map(s => s.name),
      ...LABELS.map(l => l.name),
      ...ROLES,
      'Can view',
      'Can comment',
      'Can edit',
      'Full access',
      'Daily',
      'Weekly',
      'Every 2 weeks',
      'Monthly',
      'Today',
      'Yesterday',
      'This week',
      'Earlier',
    ];
    expect(words.filter(w => !Object.prototype.hasOwnProperty.call(ptBR, w))).toEqual([]);
  });

  it('has no empty texts', () => {
    expect(
      Object.entries(ptBR)
        .filter(([, v]) => typeof v !== 'string' || !v.trim())
        .map(([k]) => k),
    ).toEqual([]);
  });
});
