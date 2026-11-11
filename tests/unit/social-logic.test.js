/* Social media: the pure logic behind the page (numbers, dates, CSV reading, series, chart geometry, goals). */
import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../src/core/i18n.js';
import {
  addDays,
  buildSeries,
  canonicalBrand,
  chartGeometry,
  csvToSnapshots,
  daysBetween,
  fmtCompact,
  fmtDelta,
  fmtNum,
  fmtPct,
  goalProgress,
  niceScale,
  parseCount,
  parseCsv,
  parseDate,
  todayIn,
  trend,
} from '../../src/social/logic.js';

afterEach(() => setLang('en'));

describe('numbers', () => {
  it('formats in the language of the interface', () => {
    expect(fmtNum(12345)).toBe('12,345');
    expect(fmtNum(null)).toBe('—');
    expect(fmtNum(undefined)).toBe('—');
    expect(fmtCompact(9999)).toBe('9,999');
    expect(fmtCompact(12345)).toBe('12.3K');
    expect(fmtDelta(200)).toBe('+200');
    expect(fmtDelta(-15)).toBe('−15');
    expect(fmtDelta(0)).toBe('0');
    expect(fmtDelta(null)).toBe('—');
    expect(fmtPct(12.5)).toBe('+12.5%');
    expect(fmtPct('-3.25')).toBe('−3.3%');
    expect(fmtPct(0)).toBe('0%');
    expect(fmtPct(null)).toBe('');
    setLang('pt-BR');
    expect(fmtNum(12345)).toBe('12.345');
    expect(fmtPct(12.5)).toBe('+12,5%');
    expect(fmtCompact(12345)).toMatch(/^12,3\smil$/);
  });

  it('says whether a change is good, bad or nothing', () => {
    expect(trend(5)).toBe('up');
    expect(trend(-5)).toBe('bad');
    expect(trend(0)).toBe('');
    expect(trend(null)).toBe('');
  });

  it('reads counts typed by a person', () => {
    expect(parseCount('12345')).toBe(12345);
    expect(parseCount(' 12.345 ')).toBe(12345);
    expect(parseCount('12,345')).toBe(12345);
    expect(parseCount('1.234.567')).toBe(1234567);
    expect(parseCount('1,2 mil')).toBe(1200);
    expect(parseCount('3.4k')).toBe(3400);
    expect(parseCount('2M')).toBe(2000000);
    expect(parseCount('0')).toBe(0);
    expect(parseCount(77)).toBe(77);
    // whole numbers a spreadsheet wrote with empty decimals
    expect(parseCount('1234,00')).toBe(1234);
    expect(parseCount('1.234,00')).toBe(1234);
    expect(parseCount('1,234.0')).toBe(1234);
    expect(parseCount('12.000')).toBe(12000); // three digits after the mark are thousands, not decimals
    expect(parseCount('1.234.000')).toBe(1234000);
    for (const bad of ['', '  ', 'many', '-5', '12.5', '1,5', '1e3', '12 345 abc', '.', ',', '1,000.5', '12,34', null, undefined, -1, NaN])
      expect(parseCount(bad), String(bad)).toBeNull();
  });
});

describe('dates', () => {
  it('reads the formats people use', () => {
    expect(parseDate('2026-01-31')).toBe('2026-01-31');
    expect(parseDate('2026-1-5')).toBe('2026-01-05');
    expect(parseDate('31/01/2026')).toBe('2026-01-31');
    expect(parseDate('5/1/2026')).toBe('2026-01-05');
    expect(parseDate('31-01-2026')).toBe('2026-01-31');
    expect(parseDate('31.01.2026')).toBe('2026-01-31');
    expect(parseDate('2026-01-31T10:00:00Z')).toBe('2026-01-31');
    expect(parseDate('2026/01/31')).toBe('2026-01-31');
    expect(parseDate('31/01/2026 09:30')).toBe('2026-01-31');
    for (const bad of ['31/02/2026', '2026-13-01', '2026-00-10', '01/31/2026', 'yesterday', '', null, '20260131', '31/01/26', '1999-12-31'])
      expect(parseDate(bad), String(bad)).toBeNull();
  });

  it('does date arithmetic on plain dates', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-03-01', '2026-02-01')).toBe(28);
    expect(daysBetween('2026-02-01', '2026-03-01')).toBe(-28);
    expect(todayIn('America/Sao_Paulo', new Date('2026-11-12T02:30:00Z'))).toBe('2026-11-11');
    expect(todayIn('America/Sao_Paulo', new Date('2026-11-12T03:00:00Z'))).toBe('2026-11-12');
  });
});

describe('CSV', () => {
  it('splits commas, semicolons and tabs, with quotes and a byte order mark', () => {
    expect(parseCsv('a,b\n1,2\n').rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a;b\r\n"1;x";"say ""hi"""\r\n\r\n').rows).toEqual([
      ['a', 'b'],
      ['1;x', 'say "hi"'],
    ]);
    expect(parseCsv('a\tb\n1\t2').sep).toBe('\t');
    expect(parseCsv(String.fromCharCode(0xfeff) + 'date,followers\n2026-01-01,5').rows[0]).toEqual(['date', 'followers']);
    expect(parseCsv('a,b\n"line\nbreak",2').rows[1]).toEqual(['line\nbreak', '2']);
    expect(parseCsv('').rows).toEqual([]);
    expect(parseCsv(null).rows).toEqual([]);
  });

  const accounts = [
    { id: 'ig', platform: 'instagram', handle: '@Acme' },
    { id: 'sb', platform: 'substack', handle: 'acmeletter' },
  ];
  const read = (text, opt) => csvToSnapshots(parseCsv(text), { accounts, today: '2026-11-11', ...opt });

  it('turns lines into snapshots of one account', () => {
    const r = read('Data;Seguidores;Visualizações\n01/11/2026;1.100;300\n02/11/2026;1.150;\n', { defaultAccountId: 'sb' });
    expect(r.errors).toEqual([]);
    expect(r.fields).toEqual(['followers', 'views']);
    expect(r.rows).toEqual([
      { account_id: 'sb', date: '2026-11-01', followers: 1100, views: 300 },
      { account_id: 'sb', date: '2026-11-02', followers: 1150 }, // an empty cell is left out: it erases nothing
    ]);
    expect(r.routed).toBe(false);
  });

  it('routes lines by platform and handle, whatever the capitals or the "@"', () => {
    const r = read('date,platform,handle,followers\n2026-11-01,Instagram,acme,10\n2026-11-01,substack,@AcmeLetter,20\n2026-11-02,tiktok,nobody,1\n');
    expect(r.rows).toEqual([
      { account_id: 'ig', date: '2026-11-01', followers: 10 },
      { account_id: 'sb', date: '2026-11-01', followers: 20 },
    ]);
    expect(r.errors).toEqual([{ line: 4, code: 'unknown-account', value: 'tiktok nobody' }]);
    expect(r.routed).toBe(true);
  });

  it('points at the line of the file, whatever comes before it', () => {
    // a blank line and a line with separators only do not shift the numbers
    expect(read('date,followers\n\n2026-11-01,x', { defaultAccountId: 'ig' }).errors).toEqual([{ line: 3, code: 'bad-number', value: 'x' }]);
    expect(read('date,followers\n2026-11-01,1\n,\n2026-11-02,x', { defaultAccountId: 'ig' }).errors).toEqual([{ line: 4, code: 'bad-number', value: 'x' }]);
    // nor does a quoted cell that spans two lines, nor Windows line ends, nor blank lines before the header
    expect(read('date,followers,likes\n2026-11-01,1,"1\n0"\n2026-11-02,x,1', { defaultAccountId: 'ig' }).errors).toEqual([
      { line: 4, code: 'bad-number', value: 'x' },
    ]);
    expect(read('date;followers\r\n\r\n\r\n01/11/2026;5\r\n31/02/2026;5\r\n', { defaultAccountId: 'ig' }).errors).toEqual([
      { line: 5, code: 'bad-date', value: '31/02/2026' },
    ]);
    expect(read('\n\nname,total\nx,1', { defaultAccountId: 'ig' }).errors).toEqual([
      { line: 3, code: 'no-date-column' },
      { line: 3, code: 'no-number-column' },
    ]);
    expect(parseCsv('a,b\n\n1,2\n"x\ny",3\n4,5').lines).toEqual([1, 3, 4, 6]);
  });

  it('finds the separator even when the text starts with blank lines', () => {
    // pasted text often starts with a line break, and spreadsheets in Portuguese write semicolons
    expect(parseCsv('\n\ndata;seguidores\n01/11/2026;1').sep).toBe(';');
    expect(parseCsv('\r\n\r\ndate\tfollowers\r\n2026-11-01\t1').sep).toBe('\t');
    expect(parseCsv('  \n\t\n \r\ndata;seguidores\r\n01/11/2026;1').sep).toBe(';');
    expect(parseCsv('\r\rdata;seguidores\r01/11/2026;1').sep).toBe(';');
    const semi = read('\n\ndata;seguidores\n01/11/2026;1.100\nruim;2\n', { defaultAccountId: 'sb' });
    expect(semi.rows).toEqual([{ account_id: 'sb', date: '2026-11-01', followers: 1100 }]);
    expect(semi.errors).toEqual([{ line: 5, code: 'bad-date', value: 'ruim' }]);
    const tab = read('\r\n\r\ndate\tplatform\thandle\tfollowers\r\n2026-11-01\tinstagram\tacme\t10\r\n', {});
    expect(tab.rows).toEqual([{ account_id: 'ig', date: '2026-11-01', followers: 10 }]);
    expect(tab.errors).toEqual([]);
    // a spreadsheet's own first line announcing the separator is honoured and is not data
    const hinted = read('sep=;\ndata;seguidores\n01/11/2026;7\nruim;1\n', { defaultAccountId: 'ig' });
    expect(hinted.rows).toEqual([{ account_id: 'ig', date: '2026-11-01', followers: 7 }]);
    expect(hinted.errors).toEqual([{ line: 4, code: 'bad-date', value: 'ruim' }]);
    expect(read('sep=\t\ndate\tfollowers\n2026-11-01\t7\n', { defaultAccountId: 'ig' }).rows).toEqual([{ account_id: 'ig', date: '2026-11-01', followers: 7 }]);
    expect(read('sep=,\r\ndate,followers\r\n2026-11-01,7\r\n', { defaultAccountId: 'ig' }).rows).toEqual([
      { account_id: 'ig', date: '2026-11-01', followers: 7 },
    ]);
    expect(read('\n sep=; \ndate;followers\n2026-11-01;7', { defaultAccountId: 'ig' }).rows).toEqual([{ account_id: 'ig', date: '2026-11-01', followers: 7 }]);
    // the announcement alone, or a header alone, is an empty import, not an error about the wrong line
    expect(read('sep=;\n', { defaultAccountId: 'ig' }).errors).toEqual([{ line: 1, code: 'empty' }]);
    expect(read('date,followers\n', { defaultAccountId: 'ig' })).toMatchObject({ rows: [], errors: [{ line: 1, code: 'no-lines' }], total: 0 });
    // a first line with only one column still reads: there is no separator to find
    expect(read('\ndate\n2026-11-01\n', { defaultAccountId: 'ig' }).errors.map(e => e.code)).toEqual(['no-number-column']);
  });

  it('reports each bad line with its number and keeps the good ones', () => {
    const r = read('date,followers,likes\n31/02/2026,1,1\n2026-11-12,1,1\n2026-11-03,many,1\n2026-11-04,,\n2026-11-05,7,\n', { defaultAccountId: 'ig' });
    expect(r.errors).toEqual([
      { line: 2, code: 'bad-date', value: '31/02/2026' },
      { line: 3, code: 'future-date', value: '2026-11-12' },
      { line: 4, code: 'bad-number', value: 'many' },
      { line: 5, code: 'no-numbers' },
    ]);
    expect(r.rows).toEqual([{ account_id: 'ig', date: '2026-11-05', followers: 7 }]);
    expect(r.total).toBe(5);
  });

  it('keeps the last line when a day appears twice, and sorts by day', () => {
    const r = read('date,followers\n2026-11-03,3\n2026-11-01,1\n2026-11-03,30\n', { defaultAccountId: 'ig' });
    expect(r.rows.map(x => [x.date, x.followers])).toEqual([
      ['2026-11-01', 1],
      ['2026-11-03', 30],
    ]);
  });

  it('refuses a file it cannot make sense of', () => {
    expect(read('').errors).toEqual([{ line: 1, code: 'empty' }]);
    expect(read('name,total\nx,1', { defaultAccountId: 'ig' }).errors.map(e => e.code)).toEqual(['no-date-column', 'no-number-column']);
    expect(read('date,followers\n2026-11-01,1').errors).toEqual([{ line: 1, code: 'no-account' }]);
    expect(read('date,platform,followers\n2026-11-01,instagram,1').errors).toEqual([{ line: 1, code: 'no-account' }]);
    expect(read('name,total\nx,1', { defaultAccountId: 'ig' }).rows).toEqual([]);
  });
});

describe('series', () => {
  const snaps = [
    { account_id: 'a', date: '2026-11-01', followers: 100 },
    { account_id: 'b', date: '2026-11-02', followers: 50 },
    { account_id: 'a', date: '2026-11-03', followers: 120 },
    { account_id: 'a', date: '2026-11-04', followers: null },
    { account_id: 'c', date: '2026-11-04', followers: 999 },
    { account_id: 'b', date: '2026-11-06', followers: 70 },
    { account_id: 'a', date: '2026-11-09', followers: 130 },
  ];
  it('adds the accounts up, carrying each one forward, and counts an account from its first number', () => {
    // b is first seen on the 2nd with 50: it counts as 50 on the 1st too, so following a new account is not a jump
    expect(buildSeries(snaps, ['a', 'b'], 'followers', '2026-11-01', '2026-11-30')).toEqual([
      { date: '2026-11-01', value: 150 },
      { date: '2026-11-02', value: 150 },
      { date: '2026-11-03', value: 170 },
      { date: '2026-11-06', value: 190 },
      { date: '2026-11-09', value: 200 },
    ]);
  });
  it('starts a window from the last value before it and stops at its end', () => {
    expect(buildSeries(snaps, ['a', 'b'], 'followers', '2026-11-05', '2026-11-08')).toEqual([
      { date: '2026-11-05', value: 170 },
      { date: '2026-11-06', value: 190 },
    ]);
    expect(buildSeries(snaps, ['a'], 'followers', '2026-11-03', '2026-11-30')).toEqual([
      { date: '2026-11-03', value: 120 },
      { date: '2026-11-09', value: 130 },
    ]);
  });
  it('is empty when the accounts have no number', () => {
    expect(buildSeries(snaps, ['z'], 'followers', '2026-11-01', '2026-11-30')).toEqual([]);
    expect(buildSeries(snaps, ['a'], 'views', '2026-11-01', '2026-11-30')).toEqual([]);
    expect(buildSeries([], ['a'], 'followers', '2026-11-01', '2026-11-30')).toEqual([]);
  });
});

describe('chart', () => {
  it('chooses round axis steps', () => {
    expect(niceScale(1000, 1800)).toEqual({ lo: 1000, hi: 1800, ticks: [1000, 1200, 1400, 1600, 1800] });
    expect(niceScale(0, 7).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(niceScale(500, 500).ticks[0]).toBeLessThan(500);
    expect(niceScale(500, 500).hi).toBeGreaterThan(500);
    expect(niceScale(0, 0)).toEqual({ lo: 0, hi: 1, ticks: [0, 1] });
    expect(niceScale(3, 4).ticks).toEqual([3, 4]);
    expect(niceScale(NaN, 1).ticks).toEqual([0, 1]);
  });
  it('places points by date and value inside a 0–100 box', () => {
    const g = chartGeometry([
      { date: '2026-11-01', value: 1000 },
      { date: '2026-11-06', value: 1400 },
      { date: '2026-11-11', value: 1800 },
    ]);
    expect(g.pts.map(p => [p.x, p.y])).toEqual([
      [0, 100],
      [50, 50],
      [100, 0],
    ]);
    expect(g.line).toBe('M0 100 L50 50 L100 0');
    expect(g.area).toBe('M0 100 L50 50 L100 0 L100 100 L0 100 Z');
    expect(chartGeometry([])).toBeNull();
    const one = chartGeometry([{ date: '2026-11-01', value: 10 }]);
    expect(one.pts[0].x).toBe(50);
    expect(one.area).toBe('');
    expect(one.pts[0].y).toBeGreaterThan(0);
    expect(one.pts[0].y).toBeLessThan(100);
  });
});

describe('goals and brands', () => {
  it('measures progress and the pace still needed', () => {
    expect(goalProgress({ target_value: 5000, target_date: '2026-12-11' }, 1800, '2026-11-11')).toEqual({
      pct: 36,
      remaining: 3200,
      done: false,
      daysLeft: 30,
      overdue: false,
      perDay: 107,
    });
    expect(goalProgress({ target_value: 5000, target_date: null }, 5200, '2026-11-11')).toEqual({
      pct: 100,
      remaining: 0,
      done: true,
      daysLeft: null,
      overdue: false,
      perDay: null,
    });
    expect(goalProgress({ target_value: 5000, target_date: '2026-11-01' }, 100, '2026-11-11')).toMatchObject({ overdue: true, perDay: null, daysLeft: -10 });
    expect(goalProgress({ target_value: 5000, target_date: '2026-11-11' }, null, '2026-11-11')).toMatchObject({
      pct: 0,
      remaining: 5000,
      perDay: null,
      overdue: false,
    });
  });
  it('reuses the spelling of a brand that already exists', () => {
    expect(canonicalBrand('  acme ', ['Acme', 'Beta'])).toBe('Acme');
    expect(canonicalBrand('ACME   Labs', ['Acme'])).toBe('ACME Labs');
    expect(canonicalBrand('', ['Acme'])).toBe('');
    expect(canonicalBrand(null, [])).toBe('');
  });
});

describe('review fixes', () => {
  it('a goal that is almost reached does not read as reached', async () => {
    // the percentage is rounded down and reads 100 only when nothing is left
    expect(goalProgress({ target_value: 2350000, target_date: null }, 2345678)).toMatchObject({ pct: 99, remaining: 4322, done: false });
    expect(goalProgress({ target_value: 1000, target_date: null }, 999)).toMatchObject({ pct: 99, done: false });
    expect(goalProgress({ target_value: 1000, target_date: null }, 1000)).toMatchObject({ pct: 100, done: true });
    expect(goalProgress({ target_value: 1000, target_date: null }, 1200)).toMatchObject({ pct: 100, done: true });
    expect(goalProgress({ target_value: 1000, target_date: null }, 5)).toMatchObject({ pct: 0, done: false });
  });

  it('every network the screen offers has an id the database accepts', async () => {
    const { PLATFORMS } = await import('../../src/social/platforms.js');
    const { PLATFORM_ALIASES } = await import('../../src/social/logic.js');
    // the check constraint of social_accounts.platform and social_collectors.platform
    for (const p of PLATFORMS) expect(p.id, p.name).toMatch(/^[a-z][a-z0-9_]{1,31}$/);
    expect(new Set(PLATFORMS.map(p => p.id)).size).toBe(PLATFORMS.length);
    for (const id of Object.values(PLATFORM_ALIASES)) expect(PLATFORMS.map(p => p.id)).toContain(id);
  });

  it('a network may be written by another of its names in a file', () => {
    const named = csvToSnapshots(parseCsv('date,platform,handle,followers\n2026-11-01,X,acme,5\n2026-11-01,Site,123,9\n'), {
      accounts: [
        { id: 'tw', platform: 'twitter', handle: 'acme' },
        { id: 'web', platform: 'website', handle: '123' },
      ],
      today: '2026-11-11',
    });
    expect(named.rows.map(x => x.account_id)).toEqual(['tw', 'web']);
    expect(named.errors).toEqual([]);
  });
});

describe('axis labels', () => {
  it('are short, and still tell the steps apart when big numbers differ a little', async () => {
    const { tickLabels } = await import('../../src/social/logic.js');
    expect(tickLabels([1000, 1200, 1400, 1600, 1800])).toEqual(['1,000', '1,200', '1,400', '1,600', '1,800']);
    expect(tickLabels([0, 5000000, 10000000])).toEqual(['0', '5M', '10M']);
    expect(tickLabels([12000, 12500, 13000])).toEqual(['12K', '12.5K', '13K']);
    const close = tickLabels([5000000000, 5000500000, 5001000000, 5001500000, 5002000000]);
    expect(new Set(close).size).toBe(5);
    expect(close[0]).toBe('5B');
    expect(close[1]).toBe('5.0005B');
    const million = tickLabels([1200000, 1201000, 1202000, 1203000]);
    expect(new Set(million).size).toBe(4);
    expect(tickLabels([7])).toEqual(['7']);
  });
});
