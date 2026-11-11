/* ---------- SOCIAL MEDIA · dashboard ----------
   What the page shows once there are accounts: collection alerts, filters, totals, one card per account,
   the growth chart, totals per brand, goals and the best posts. Everything is derived from what ./data.js loaded. */
import { ago, esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { shortDay, tr, trn } from '../core/i18n.js';
import { progBar } from '../ui/helpers.js';
import { S } from '../core/store.js';
import { render } from '../shell/render.js';
import { SOC, accountById, brandNames, filteredAccounts, goalOf, growthOf, platformIds, postsOnScreen } from './data.js';
import { audienceLabel, platformName, platformOf, profileUrl } from './platforms.js';
import { addDays, buildSeries, chartGeometry, fmtCompact, fmtDelta, fmtNum, fmtPct, goalProgress, todayIn, trend } from './logic.js';

/* ---------- small pieces ---------- */
export const dateText = (d, long) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return shortDay(new Date(y, m - 1, day), long || y !== new Date().getFullYear());
};
export const mark = platform => `<span class="soc-mark" aria-hidden="true">${esc(platformOf(platform).mark)}</span>`;
const option = (value, label, current) => `<option value="${esc(value)}" ${String(current ?? '') === String(value) ? 'selected' : ''}>${esc(label)}</option>`;
const sum = (rows, key) => rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);
const pctOf = (delta, base) => (base > 0 ? (delta / base) * 100 : null);
/* "+200 · +12.5%" with the colour of its direction. The sign carries the meaning too, not only the colour. */
const change = (delta, pct, compact) =>
  delta === null || delta === undefined
    ? `<span class="faint">—</span>`
    : `<span class="soc-chg ${trend(delta)}">${fmtDelta(delta, compact)}${fmtPct(pct) && delta !== 0 ? `<span class="soc-pct"> ${fmtPct(pct)}</span>` : ''}</span>`;
export const PERIODS = ['7', '30', '90', '365'];
/* The short label of a period, as written on its button. */
const periodShort = p => ({ 7: tr('7d'), 30: tr('30d'), 90: tr('90d'), 365: tr('12m') })[p];
const periodName = p => ({ 7: tr('7 days'), 30: tr('30 days'), 90: tr('90 days'), 365: tr('12 months') })[p];
const sourceName = s => (s === 'manual' ? tr('typed by hand') : s === 'csv' ? tr('from a CSV') : tr('collected automatically'));

/* ---------- alerts: the last automatic collection of a network failed ---------- */
export function alerts() {
  // only the networks that are on screen: with a brand or network filter, the others are not this view's business
  const live = new Set(filteredAccounts().map(a => a.platform));
  return SOC.runs
    .filter(r => live.has(r.platform) && (r.status === 'error' || r.status === 'partial'))
    .map(r => {
      const failed = r.status === 'error';
      const name = esc(platformName(r.platform));
      const when = r.finished_at ? ago(Date.parse(r.finished_at)) : '';
      const head = failed
        ? tr('{network}: the last automatic collection failed.', { network: name })
        : tr('{network}: the last automatic collection brought {ok} of {total} accounts.', { network: name, ok: r.accounts_ok, total: r.accounts_total });
      return `<div class="alert ${failed ? 'danger' : 'warn'} soc-alert" role="alert" data-platform="${esc(r.platform)}">${ic('triangle-alert', 15)}<span class="grow"><b>${head}</b> <span class="faint">${esc(when)}</span>
        <span class="soc-alert-text">${tr("The numbers on screen are the last ones that arrived. You can enter today's by hand.")}</span>
        ${r.message ? `<span class="soc-alert-msg">${esc(r.message)}</span>` : ''}</span>
        <button class="btn btn-sm btn-secondary" data-a="socialNumbers" data-platform="${esc(r.platform)}">${tr('Enter numbers')}</button></div>`;
    })
    .join('');
}

/* ---------- filters ---------- */
export function filterBar() {
  const f = SOC.filters;
  const brands = brandNames();
  const platforms = platformIds();
  if (brands.length < 2 && platforms.length < 2) return '';
  const active = f.brand || f.platform;
  return `<div class="soc-filters" role="group" aria-label="${tr('Filters')}">
    ${brands.length > 1 ? `<select class="select" style="width:auto;min-width:150px" data-in="socialFilter" data-f="brand" aria-label="${tr('Brand')}">${option('', tr('All brands'), f.brand)}${brands.map(b => option(b, b, f.brand)).join('')}</select>` : ''}
    ${platforms.length > 1 ? `<select class="select" style="width:auto;min-width:150px" data-in="socialFilter" data-f="platform" aria-label="${tr('Network')}">${option('', tr('All networks'), f.platform)}${platforms.map(p => option(p, platformName(p), f.platform)).join('')}</select>` : ''}
    ${active ? `<button class="btn btn-ghost btn-sm" data-a="socialClearFilters">${ic('x', 13)}${tr('Clear filters')}</button>` : ''}
  </div>`;
}

/* ---------- totals of what is on screen ---------- */
export function stats(accounts) {
  const rows = accounts.map(a => growthOf(a.id)).filter(g => g && g.followers !== null && g.followers !== undefined);
  const total = sum(rows, 'followers');
  const cell = (label, delta, base) =>
    `<div class="stat"><span class="k">${label}</span><span class="v soc-v">${rows.length ? `<span class="${trend(delta)}">${fmtDelta(delta, true)}</span>` : '—'}</span><span class="d">${rows.length && fmtPct(pctOf(delta, base)) ? fmtPct(pctOf(delta, base)) : '&nbsp;'}</span></div>`;
  return `<div class="stats soc-stats">
    <div class="stat"><span class="k">${tr('Audience')}</span><span class="v soc-v">${rows.length ? fmtCompact(total) : '—'}</span><span class="d">${trn('{n} account', '{n} accounts', accounts.length)}</span></div>
    ${cell(tr('7 days'), sum(rows, 'growth_7d'), sum(rows, 'followers_7d_ago'))}
    ${cell(tr('30 days'), sum(rows, 'growth_30d'), sum(rows, 'followers_30d_ago'))}
    ${cell(tr('Since the start'), sum(rows, 'growth_total'), sum(rows, 'first_followers'))}
  </div>`;
}

/* ---------- one card per account ---------- */
function sparkline(accountId) {
  const today = todayIn();
  const series = buildSeries(SOC.snapshots, [accountId], 'followers', addDays(today, -30), today);
  if (series.length < 2) return `<div class="soc-spark soc-spark-empty"></div>`;
  const g = chartGeometry(series);
  return `<svg class="soc-spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${g.line}" /></svg>`;
}
export function cards(accounts) {
  const failing = new Set(SOC.runs.filter(r => r.status === 'error').map(r => r.platform));
  return `<div class="soc-cards">${accounts
    .map(a => {
      const g = growthOf(a.id);
      const has = g && g.followers !== null && g.followers !== undefined;
      const link = profileUrl(a);
      const name = esc(a.display_name || a.handle);
      const goal = goalOf(a.id);
      const gp = goal ? goalProgress(goal, has ? Number(g.followers) : null) : null;
      const last = has ? [...SOC.snapshots].reverse().find(s => s.account_id === a.id && s.followers !== null) : null;
      return `<article class="soc-card" data-account="${a.id}" aria-label="${esc(platformName(a.platform))} ${name}">
        <header class="soc-card-h">${mark(a.platform)}<div class="soc-card-t"><b class="trunc">${esc(platformName(a.platform))}</b><span class="faint trunc">${link ? `<a class="link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${name}</a>` : name} · ${esc(a.brand)}</span></div>
          ${failing.has(a.platform) && a.is_active ? `<span class="badge red" title="${tr('The last automatic collection of this network failed.')}">${ic('triangle-alert', 11)}${tr('Collection failed')}</span>` : ''}</header>
        <div class="soc-card-n"><span class="soc-big num">${has ? fmtNum(Number(g.followers)) : '—'}</span><span class="faint">${audienceLabel(a.platform)}</span></div>
        ${
          has
            ? `<dl class="soc-card-d"><div><dt>${tr('7 days')}</dt><dd>${change(g.growth_7d, g.growth_7d_pct, true)}</dd></div><div><dt>${tr('30 days')}</dt><dd>${change(g.growth_30d, g.growth_30d_pct, true)}</dd></div></dl>${sparkline(a.id)}`
            : `<p class="soc-card-empty">${tr('No numbers yet. Enter them by hand, import a CSV or wait for the next collection.')}</p>`
        }
        ${
          gp
            ? `<div class="soc-goal" title="${tr('Goal')}"><div class="row" style="gap:8px">${progBar(gp.pct, gp.done ? 'green' : gp.overdue ? 'red' : '')}<span class="num faint" style="font-size:11.5px">${gp.pct}%</span></div><span class="faint">${tr('Goal: {target}', { target: fmtNum(Number(goal.target_value)) })}${goal.target_date ? ' · ' + dateText(goal.target_date) : ''}</span></div>`
            : ''
        }
        <footer class="soc-card-f"><span class="faint trunc">${has ? `${dateText(g.last_date)}${last ? ' · ' + sourceName(last.source) : ''}` : a.is_active ? tr('waiting for numbers') : tr('collection paused')}</span>
          <span class="soc-card-a">
            <button class="ibtn ibtn-sm" data-a="socialNumbers" data-id="${a.id}" data-tip="${tr('Enter numbers')}" aria-label="${tr('Enter numbers for {name}', { name })}">${ic('pencil-line', 15)}</button>
            <button class="ibtn ibtn-sm" data-a="socialGoal" data-id="${a.id}" data-tip="${goal ? tr('Edit goal') : tr('Set a goal')}" aria-label="${tr('Goal for {name}', { name })}">${ic('target', 15)}</button>
            <button class="ibtn ibtn-sm" data-a="socialEdit" data-id="${a.id}" data-tip="${tr('Edit account')}" aria-label="${tr('Edit {name}', { name })}">${ic('settings-2', 15)}</button>
            <button class="ibtn ibtn-sm" data-a="socialRemove" data-id="${a.id}" data-tip="${tr('Remove account')}" aria-label="${tr('Remove {name}', { name })}">${ic('trash-2', 15)}</button>
          </span></footer>
      </article>`;
    })
    .join('')}</div>`;
}

/* ---------- growth chart ----------
   One line: the audience of the accounts on screen, added up (or one account, chosen in the panel). Comparing
   accounts is done with the cards above, each with its own small line, instead of many colours in one plot. */
export function chartPanel(accounts) {
  const f = SOC.filters;
  if (f.account && !accounts.some(a => a.id === f.account)) f.account = '';
  const ids = f.account ? [f.account] : accounts.map(a => a.id);
  const today = todayIn();
  const days = Number(f.period) || 90;
  const series = buildSeries(SOC.snapshots, ids, 'followers', addDays(today, -days), today);
  const g = chartGeometry(series);
  SOC.chart = g ? { pts: g.pts } : null;
  const one = f.account ? accountById(f.account) : null;
  const label = one ? audienceLabel(one.platform) : tr('Audience');
  const first = series[0],
    last = series[series.length - 1];
  const delta = series.length > 1 ? last.value - first.value : null;

  const controls = `<div class="soc-chart-c">
    ${accounts.length > 1 ? `<select class="select" style="width:auto;min-width:150px;max-width:220px" data-in="socialFilter" data-f="account" aria-label="${tr('Account')}">${option('', tr('All accounts'), f.account)}${accounts.map(a => option(a.id, `${platformName(a.platform)} · ${a.display_name || a.handle}`, f.account)).join('')}</select>` : ''}
    <div class="seg" role="group" aria-label="${tr('Period')}">${PERIODS.map(v => `<button class="${f.period === v ? 'on' : ''}" data-a="socialPeriod" data-v="${v}" aria-pressed="${f.period === v}" aria-label="${periodName(v)}">${periodShort(v)}</button>`).join('')}</div>
    <button class="ibtn ibtn-sm ${SOC.table ? 'on' : ''}" data-a="socialToggleTable" aria-pressed="${SOC.table}" data-tip="${SOC.table ? tr('Show chart') : tr('Show table')}" aria-label="${SOC.table ? tr('Show chart') : tr('Show table')}">${ic(SOC.table ? 'chart-line' : 'table-2', 15)}</button>
  </div>`;
  const headline = last
    ? `<div class="soc-chart-n"><span class="soc-big num">${fmtNum(last.value)}</span><span class="faint">${esc(label)}</span>${delta !== null ? `<span class="soc-chart-chg">${change(delta, pctOf(delta, first.value))} <span class="faint">${tr('in {period}', { period: periodName(f.period) })}</span></span>` : ''}</div>`
    : '';

  let body;
  if (!g) body = `<div class="soc-chart-empty">${ic('chart-line', 18)}<span>${tr('No numbers in this period.')}</span></div>`;
  else if (SOC.table)
    body = `<div class="soc-table-wrap" tabindex="0"><table class="soc-table"><caption class="sr">${esc(label)}</caption><thead><tr><th scope="col">${tr('Day')}</th><th scope="col">${esc(label)}</th><th scope="col">${tr('Change')}</th></tr></thead><tbody>${[
      ...series,
    ]
      .reverse()
      .map((p, i, arr) => {
        const prev = arr[i + 1];
        return `<tr><td>${dateText(p.date, true)}</td><td class="num">${fmtNum(p.value)}</td><td class="num">${prev ? change(p.value - prev.value, null) : '<span class="faint">—</span>'}</td></tr>`;
      })
      .join('')}</tbody></table></div>`;
  else {
    const ticks = g.scale.ticks;
    const yOf = v => 100 - ((v - g.scale.lo) / Math.max(1, g.scale.hi - g.scale.lo)) * 100;
    // dates under the line, each at its own place: the ends always, the middle point only when it is not crowding them
    const mid = g.pts[Math.floor((g.pts.length - 1) / 2)];
    const xLabels =
      g.pts.length === 1
        ? `<span class="m" style="left:50%">${dateText(first.date)}</span>`
        : `<span class="s">${dateText(first.date)}</span>${mid.x > 24 && mid.x < 76 ? `<span class="m" style="left:${mid.x}%">${dateText(mid.date)}</span>` : ''}<span class="e">${dateText(last.date)}</span>`;
    body = `<div class="soc-chart">
      <div class="soc-y" aria-hidden="true">${ticks.map(t => `<span style="top:${yOf(t)}%">${fmtCompact(t)}</span>`).join('')}</div>
      <div class="soc-plot" tabindex="0" role="img" aria-label="${tr('{label} from {from} to {to}: {first} to {last}. Use the arrow keys to read each day, or switch to the table.', { label: esc(label), from: dateText(first.date, true), to: dateText(last.date, true), first: fmtNum(first.value), last: fmtNum(last.value) })}">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          ${ticks.map(t => `<line class="soc-grid" x1="0" x2="100" y1="${yOf(t)}" y2="${yOf(t)}" />`).join('')}
          ${g.area ? `<path class="soc-area" d="${g.area}" />` : ''}
          ${g.pts.length > 1 ? `<path class="soc-line" d="${g.line}" />` : ''}
        </svg>
        ${g.pts.length === 1 ? `<i class="soc-dot" style="left:${g.pts[0].x}%;top:${g.pts[0].y}%"></i>` : `<i class="soc-dot soc-end" style="left:${g.pts[g.pts.length - 1].x}%;top:${g.pts[g.pts.length - 1].y}%"></i>`}
        <i class="soc-cross" hidden></i><i class="soc-dot soc-hover" hidden></i>
        <div class="soc-tip" role="status" hidden></div>
      </div>
      <div class="soc-x" aria-hidden="true">${xLabels}</div>
    </div>`;
  }
  return `<section class="panel soc-chart-panel"><div class="panel-h"><h2>${tr('Growth')}</h2><div class="acts">${controls}</div></div><div class="panel-b">${headline}${body}</div></section>`;
}

/* ---------- totals per brand (every brand, whatever the filters) ---------- */
export function brandTotals() {
  if (!SOC.brands.length) return '';
  const rows = SOC.brands
    .map(
      b => `<div class="soc-brow" role="row"><span role="rowheader" class="soc-bname"><b class="trunc">${esc(b.brand)}</b><span class="faint">${trn('{n} account', '{n} accounts', b.accounts)}</span></span>
        <span role="cell" class="num">${b.accounts_with_data ? fmtCompact(Number(b.followers)) : '—'}</span>
        <span role="cell" class="num">${b.accounts_with_data ? change(Number(b.growth_7d), b.growth_7d_pct, true) : '—'}</span>
        <span role="cell" class="num">${b.accounts_with_data ? change(Number(b.growth_30d), b.growth_30d_pct, true) : '—'}</span>
        <span role="cell" class="num soc-btotal">${b.accounts_with_data ? change(Number(b.growth_total), b.growth_total_pct, true) : '—'}</span></div>`,
    )
    .join('');
  return `<section class="panel"><div class="panel-h"><h2>${tr('Totals per brand')}</h2></div>
    <div class="soc-btable" role="table" aria-label="${tr('Totals per brand')}">
      <div class="soc-brow soc-bhead" role="row"><span role="columnheader">${tr('Brand')}</span><span role="columnheader">${tr('Audience')}</span><span role="columnheader">${tr('7 days')}</span><span role="columnheader">${tr('30 days')}</span><span role="columnheader" class="soc-btotal">${tr('Since the start')}</span></div>
      ${rows}
    </div></section>`;
}

/* ---------- goals ---------- */
export function goalsPanel(accounts) {
  const ids = new Set(accounts.map(a => a.id));
  const goals = SOC.goals.filter(g => g.metric === 'followers' && ids.has(g.account_id));
  const add = `<button class="btn btn-secondary btn-sm" data-a="socialGoal">${ic('target', 13)}${tr('Set a goal')}</button>`;
  const rows = goals
    .map(goal => {
      const a = accountById(goal.account_id);
      const g = growthOf(goal.account_id);
      const current = g && g.followers !== null && g.followers !== undefined ? Number(g.followers) : null;
      const p = goalProgress(goal, current);
      const note = p.done
        ? tr('Reached')
        : p.overdue
          ? tr('{n} to go · the date has passed', { n: fmtNum(p.remaining) })
          : p.perDay
            ? tr('{n} to go · {perDay} a day until {date}', { n: fmtNum(p.remaining), perDay: fmtNum(p.perDay), date: dateText(goal.target_date) })
            : tr('{n} to go', { n: fmtNum(p.remaining) });
      return `<button class="soc-grow" data-a="socialGoal" data-id="${goal.account_id}" aria-label="${tr('Edit goal')}: ${esc(platformName(a.platform))} ${esc(a.display_name || a.handle)}">
        <span class="row" style="gap:8px">${mark(a.platform)}<span class="grow soc-gname"><b class="trunc">${esc(a.display_name || a.handle)}</b><span class="faint trunc">${fmtNum(current)} / ${fmtNum(Number(goal.target_value))} ${esc(audienceLabel(a.platform).toLowerCase())}</span></span><span class="num soc-gpct">${p.pct}%</span></span>
        ${progBar(p.pct, p.done ? 'green' : p.overdue ? 'red' : '')}
        <span class="faint soc-gnote">${note}</span></button>`;
    })
    .join('');
  return `<section class="panel"><div class="panel-h"><h2>${tr('Goals')}</h2><div class="acts">${goals.length ? add : ''}</div></div>
    ${goals.length ? `<div class="soc-goals">${rows}</div>` : `<div class="soc-none">${ic('target', 18)}<span>${tr('No goals yet. Set a number to reach and follow the progress here.')}</span>${add}</div>`}</section>`;
}

/* ---------- best posts ---------- */
export function topPosts(accounts) {
  const posts = postsOnScreen(accounts, () => S.ui.route === 'social' && render()).slice(0, 8);
  const metric = (icon, n, label) =>
    n === null || n === undefined
      ? ''
      : `<span class="soc-pm" title="${label}">${ic(icon, 12)}<span class="num">${fmtCompact(Number(n))}</span><span class="sr">${label}</span></span>`;
  const rows = posts
    .map((p, i) => {
      const a = accountById(p.account_id);
      const url = /^https?:\/\//i.test(p.url || '') ? p.url : '';
      const text = (p.caption || '').trim();
      return `<li class="soc-post"><span class="soc-rank num" aria-hidden="true">${i + 1}</span>${mark(a.platform)}
        <div class="soc-post-t"><span class="soc-cap">${text ? esc(text.slice(0, 220)) : `<span class="faint">${tr('No caption')}</span>`}</span>
          <span class="faint trunc soc-post-m">${esc(a.display_name || a.handle)}${p.posted_at ? ' · ' + dateText(p.posted_at) : ''}${p.post_type ? ' · ' + esc(p.post_type) : ''}</span>
          <span class="soc-post-n">${metric('heart', p.likes, tr('Likes'))}${metric('message-circle', p.comments, tr('Comments'))}${metric('repeat-2', p.shares, tr('Shares'))}${metric('eye', p.views, tr('Views|social'))}</span></div>
        <div class="soc-post-e"><b class="num">${fmtCompact(Number(p.engagement))}</b><span class="faint">${tr('interactions')}</span></div>
        ${url ? `<a class="ibtn ibtn-sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer" data-tip="${tr('Open post')}" aria-label="${tr('Open post')}">${ic('external-link', 14)}</a>` : '<span class="soc-nolink"></span>'}</li>`;
    })
    .join('');
  return `<section class="panel"><div class="panel-h"><h2>${tr('Best posts')}</h2><div class="acts"><span class="faint" style="font-size:11.5px">${tr('By likes, comments and shares')}</span></div></div>
    ${posts.length ? `<ol class="soc-posts">${rows}</ol>` : `<div class="soc-none">${ic('message-circle', 18)}<span>${tr('No posts yet. They arrive with the automatic collection of each network.')}</span></div>`}</section>`;
}

/* ---------- the whole dashboard ---------- */
export function dashboard() {
  const accounts = filteredAccounts();
  if (!accounts.length)
    return `${alerts()}${filterBar()}<div class="soc-none soc-none-lg">${ic('filter', 18)}<span>${tr('No account matches these filters.')}</span><button class="btn btn-secondary btn-sm" data-a="socialClearFilters">${tr('Clear filters')}</button></div>`;
  return `${alerts()}${filterBar()}${stats(accounts)}${cards(accounts)}
    <div class="grid2 soc-grid">${chartPanel(accounts)}<div class="stack">${brandTotals()}${goalsPanel(accounts)}</div></div>
    ${topPosts(accounts)}`;
}
