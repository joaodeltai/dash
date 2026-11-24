/* Content: ideas bank, planning list, production kanban, and the piece page. */
import { TODAY, esc, iso, relDate, sanitizeHtml } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { tr } from '../core/i18n.js';
import {
  BRANDS,
  CHANNELS,
  CONTENT_TABS,
  FORMATS,
  THEME_PRESET,
  boardStages,
  brandLabel,
  channelLabel,
  filterItems,
  formatLabel,
  stageByKind,
  stageColor,
  stageLabel,
} from '../core/content.js';
import { D, S, canCreate, contentItem, contentStage, contentStages } from '../core/store.js';
import { empty } from '../ui/helpers.js';
import { fxc } from '../shell/render.js';

const today = () => iso(TODAY);
const filters = () => Object.assign({ format: 'all', brand: 'all', theme: 'all', channel: 'all', when: 'all' }, S.ui.contentFilter);
const q = () => S.ui.contentQ || '';
const draft = () => Object.assign({ title: '', source: '', format: '', brand: '', theme: '', tags: '', channels: [] }, S.ui.ideaDraft);

function opts(list, value) {
  return list.map(([id, label]) => `<option value="${esc(id)}" ${value === id ? 'selected' : ''}>${esc(label)}</option>`).join('');
}

export function contentTabLabel(tab) {
  const row = CONTENT_TABS.find(t => t[0] === tab);
  return tr(row ? row[1] : 'Ideas');
}

export function pageContent() {
  if (D().contentReady === false) return schemaMissing();
  if (!canCreate()) return noAccess();
  if (S.ui.params.id) return piecePage(contentItem(S.ui.params.id));
  const tab = CONTENT_TABS.some(t => t[0] === S.ui.params.tab) ? S.ui.params.tab : 'ideas';
  return `<div class="page flush content-page">
    ${header(tab)}
    ${tabs(tab)}
    <div class="pbody content-body${S.ui.fx.tab ? ' fx-tab' : ''}">${tab === 'board' ? board() : tab === 'plan' ? planning() : ideas()}</div>
  </div>`;
}

function tabs(tab) {
  return `<nav class="tabs content-tabs" aria-label="${tr('Content')}">
    ${CONTENT_TABS.map(([k, n, i]) => `<button class="tab ${tab === k ? 'on' : ''}" ${tab === k ? 'aria-current="page"' : ''} data-a="go" data-r="content" data-tab="${k}">${ic(i, 14)}${tr(n)}</button>`).join('')}
  </nav>`;
}

function header(tab) {
  const n = {
    ideas: (D().contentItems || []).filter(i => contentStage(i.stage)?.kind === 'idea').length,
    plan: (D().contentItems || []).filter(i => contentStage(i.stage)?.kind === 'planning').length,
    board: (D().contentItems || []).filter(i => {
      const k = contentStage(i.stage)?.kind;
      return k === 'production' || k === 'published';
    }).length,
  };
  const sub = {
    ideas: tr('{n} in the ideas bank', { n: n.ideas }),
    plan: tr('{n} being planned', { n: n.plan }),
    board: tr('{n} on the board', { n: n.board }),
  };
  return `<div class="ph"><div><h1>${tr('Content')}</h1><p>${sub[tab] || ''}</p></div></div>`;
}

function schemaMissing() {
  return `<div class="page"><div class="panel">${empty(
    'database',
    tr('Content is not in the database yet'),
    tr('Apply the migration supabase/migrations/20261124220000_content.sql, then reload. The rest of the workspace keeps working until then.'),
  )}</div></div>`;
}
function noAccess() {
  return `<div class="page"><div class="panel">${empty('lock', tr("You don't have access"), tr('Guests cannot open the content area.'))}</div></div>`;
}

function ideas() {
  const stage = stageByKind(contentStages(), 'idea');
  const items = filterItems(
    (D().contentItems || []).filter(i => i.stage === stage?.id),
    { ...filters(), q: q(), today: today() },
  ).sort((a, b) => (b.created || 0) - (a.created || 0));
  const all = (D().contentItems || []).filter(i => i.stage === stage?.id);
  return `${capture()}${toolbar(tr('Search ideas'))}
    ${
      !stage
        ? `<div class="panel content-panel">${empty('square-kanban', tr('No stages yet'), tr('Content stages are created with the workspace. Reload if you just applied the migration.'))}</div>`
        : !all.length
          ? `<div class="panel content-panel">${empty('lightbulb', tr('No ideas yet'), tr('Capture a title. Format, brand and channels can wait.'))}</div>`
          : !items.length
            ? `<div class="panel content-panel">${empty('search-x', tr('No results found'), tr('No ideas match these filters.'), `<button class="btn btn-secondary btn-sm" data-a="clearContentFilters">${tr('Clear filters')}</button>`)}</div>`
            : `<div class="idea-grid">${items.map(ideaCard).join('')}</div>`
    }`;
}

function capture() {
  const d = draft();
  return `<form class="idea-capture" data-submit="createIdea">
    <div class="idea-capture-row">
      <input class="input" id="idea-title" data-in="ideaDraft" data-f="title" value="${esc(d.title)}" placeholder="${tr('Idea title')}" aria-label="${tr('Idea title')}" maxlength="200">
      <input class="input" id="idea-source" data-in="ideaDraft" data-f="source" value="${esc(d.source)}" placeholder="${tr('Source or reference')}" aria-label="${tr('Source or reference')}" maxlength="500">
      <button class="btn btn-primary" type="submit">${ic('plus', 14)}${tr('Save idea')}</button>
    </div>
    <div class="idea-capture-row">
      <select class="select" id="idea-format" data-in="ideaDraft" data-f="format" aria-label="${tr('Format')}">${opts([['', tr('Format')], ...FORMATS.map(f => [f.id, tr(f.name)])], d.format)}</select>
      <select class="select" id="idea-brand" data-in="ideaDraft" data-f="brand" aria-label="${tr('Brand')}">${opts([['', tr('Brand')], ...BRANDS.map(b => [b.id, b.name])], d.brand)}</select>
      <input class="input" id="idea-theme" data-in="ideaDraft" data-f="theme" value="${esc(d.theme)}" placeholder="${tr('Theme')}" aria-label="${tr('Theme')}" maxlength="80">
      <button class="btn btn-ghost btn-sm" type="button" data-a="ideaTheme" data-v="${esc(THEME_PRESET)}">${esc(THEME_PRESET)}</button>
      <input class="input" id="idea-tags" data-in="ideaDraft" data-f="tags" value="${esc(d.tags)}" placeholder="${tr('Tags, comma separated')}" aria-label="${tr('Tags')}" maxlength="200">
    </div>
    <div class="idea-channels" role="group" aria-label="${tr('Channels')}">
      ${CHANNELS.map(c => `<label class="checkline"><input type="checkbox" data-in="ideaDraft" data-f="channel" value="${c.id}" ${(d.channels || []).includes(c.id) ? 'checked' : ''}>${esc(c.name)}</label>`).join('')}
    </div>
  </form>`;
}

function ideaCard(item) {
  return `<article class="idea-card${fxc('added', item.id)}">
    <div class="idea-card-top"><span class="key">${esc(item.key)}</span><span class="sp"></span>
      <button class="btn btn-secondary btn-sm" data-a="promoteIdea" data-id="${item.id}">${tr('Promote')}</button>
    </div>
    <button class="idea-open" data-a="openPiece" data-id="${item.id}">${esc(item.title)}</button>
    ${item.source ? `<p class="idea-source">${esc(item.source)}</p>` : ''}
    <div class="deal-tags">${metaChips(item)}</div>
  </article>`;
}

function planning() {
  const stage = stageByKind(contentStages(), 'planning');
  const items = filterItems(
    (D().contentItems || []).filter(i => i.stage === stage?.id),
    { ...filters(), q: q(), today: today() },
  ).sort((a, b) => (a.target || '9999').localeCompare(b.target || '9999') || a.title.localeCompare(b.title));
  return `${toolbar(tr('Search pieces'))}
    ${
      !items.length
        ? `<div class="panel content-panel">${empty('notebook-pen', tr('Nothing in planning'), tr('Promote an idea when it is ready for a brief. Pieces already on the board stay on the board.'))}</div>`
        : `<div class="tbl-wrap crm-table"><table class="tbl"><thead><tr>
            <th>${tr('Piece')}</th><th>${tr('Format')}</th><th>${tr('Brand')}</th><th>${tr('Channels')}</th><th>${tr('Target date')}</th><th></th>
          </tr></thead><tbody>${items
            .map(item => {
              const ch = (item.channels || []).map(c => tr(channelLabel(c.channel))).filter(Boolean);
              return `<tr class="content-row">
                <td><button class="idea-open" data-a="openPiece" data-id="${item.id}"><span class="key">${esc(item.key)}</span> ${esc(item.title)}</button></td>
                <td>${esc(tr(formatLabel(item.format)) || '—')}</td>
                <td>${esc(brandLabel(item.brand) || '—')}</td>
                <td>${esc(ch.join(', ') || '—')}</td>
                <td>${item.target ? esc(relDate(item.target)) : '—'}</td>
                <td><button class="btn btn-secondary btn-sm" data-a="startProduction" data-id="${item.id}">${tr('Start production')}</button></td>
              </tr>`;
            })
            .join('')}</tbody></table></div>`
    }`;
}

function board() {
  const stages = boardStages(contentStages());
  const items = filterItems(D().contentItems || [], { ...filters(), q: q(), today: today() });
  return `${toolbar(tr('Search pieces'))}
    ${
      stages.length
        ? `<div class="board content-board" data-keep="content-board">${stages
            .map(s => {
              const col = items.filter(i => i.stage === s.id).sort((a, b) => a.order - b.order);
              return `<section class="bcol ${s.kind === 'published' ? 'won' : ''}" data-drop-piece="${s.id}" aria-label="${esc(tr(stageLabel(s)))}">
                <div class="bcol-h"><span class="sdot" style="background:${stageColor(s.color)}"></span><span class="trunc">${esc(tr(stageLabel(s)))}</span><span class="cnt">${col.length}</span>
                  <span class="acts"><button class="ibtn ibtn-xs" data-a="addPiece" data-stage="${s.id}" data-tip="${tr('Add piece')}" aria-label="${tr('Add piece to {name}', { name: tr(stageLabel(s)) })}">${ic('plus', 14)}</button></span>
                </div>
                <div class="bcol-b" data-piece-body="${s.id}">
                  ${col.map(item => pieceCard(item)).join('')}
                  <button class="addcard" data-a="addPiece" data-stage="${s.id}">${ic('plus', 14)}${tr('Add piece')}</button>
                </div>
              </section>`;
            })
            .join('')}</div>`
        : `<div class="panel content-panel">${empty('square-kanban', tr('No stages yet'), tr('Content stages are created with the workspace. Reload if you just applied the migration.'))}</div>`
    }`;
}

function pieceCard(item) {
  const day = today();
  const late = item.target && item.target < day && contentStage(item.stage)?.kind !== 'published';
  const ch = (item.channels || []).map(c => tr(channelLabel(c.channel))).filter(Boolean);
  return `<div class="kcard piececard ${fxc('moved', item.id)}${fxc('added', item.id)}" draggable="true" data-drag-piece="${item.id}" data-a="openPiece" data-id="${item.id}" role="button" tabindex="0" aria-label="${esc(item.title)}">
    <div class="title">${esc(item.title)}</div>
    <div class="deal-tags">${metaChips(item)}</div>
    <div class="meta">
      <span class="key">${esc(item.key)}</span>
      ${ch.length ? `<span class="m trunc" data-tip="${esc(ch.join(', '))}">${ic('share-2', 12)}${ch.length}</span>` : ''}
      ${item.target ? `<span class="m due ${late ? 'over' : ''}">${ic('calendar', 12)}${esc(relDate(item.target))}</span>` : ''}
    </div>
  </div>`;
}

function metaChips(item) {
  const chips = [];
  if (item.format) chips.push(tr(formatLabel(item.format)));
  if (item.brand) chips.push(brandLabel(item.brand));
  if (item.theme) chips.push(item.theme);
  for (const t of (item.tags || []).slice(0, 3)) chips.push(t);
  for (const c of item.channels || []) chips.push(tr(channelLabel(c.channel)));
  if (!chips.length) return `<span class="faint">${tr('No labels yet')}</span>`;
  return chips.map(t => `<span class="deal-tag">${esc(t)}</span>`).join('');
}

function toolbar(placeholder) {
  const f = filters();
  const filtered = f.format !== 'all' || f.brand !== 'all' || f.theme !== 'all' || f.channel !== 'all' || f.when !== 'all' || q();
  return `<div class="content-tools">
    <div class="inwrap">${ic('search', 13)}<input class="input search-sm" id="content-q" data-in="contentQ" placeholder="${placeholder}" value="${esc(q())}" aria-label="${placeholder}"></div>
    <select class="select" data-in="contentFilter" data-f="format" aria-label="${tr('Format')}">${opts([['all', tr('All formats')], ...FORMATS.map(x => [x.id, tr(x.name)])], f.format)}</select>
    <select class="select" data-in="contentFilter" data-f="brand" aria-label="${tr('Brand')}">${opts([['all', tr('All brands')], ...BRANDS.map(b => [b.id, b.name])], f.brand)}</select>
    <select class="select" data-in="contentFilter" data-f="channel" aria-label="${tr('Channel')}">${opts([['all', tr('All channels')], ...CHANNELS.map(c => [c.id, tr(c.name)])], f.channel)}</select>
    <select class="select" data-in="contentFilter" data-f="theme" aria-label="${tr('Theme')}">${opts(
      [
        ['all', tr('All themes')],
        ['preset', THEME_PRESET],
        ['other', tr('Other theme')],
      ],
      f.theme,
    )}</select>
    <select class="select" data-in="contentFilter" data-f="when" aria-label="${tr('Target date')}">${opts(
      [
        ['all', tr('Any date')],
        ['week', tr('Next 7 days')],
        ['overdue', tr('Overdue')],
        ['undated', tr('No date')],
      ],
      f.when,
    )}</select>
    ${filtered ? `<button class="btn btn-ghost btn-sm" data-a="clearContentFilters">${tr('Clear filters')}</button>` : ''}
  </div>`;
}

function piecePage(item) {
  if (!item) {
    return `<div class="page"><div class="panel">${empty(
      'file-x',
      tr('Piece not found'),
      tr('It may have been deleted.'),
      `<button class="btn btn-secondary btn-sm" data-a="go" data-r="content" data-tab="ideas">${tr('Back to ideas')}</button>`,
    )}</div></div>`;
  }
  const stage = contentStage(item.stage);
  const kind = stage?.kind;
  const stages = contentStages();
  const tab = kind === 'idea' ? 'ideas' : kind === 'planning' ? 'plan' : 'board';
  return `<div class="page content-piece">
    ${tabs(tab)}
    <div class="ph">
      <div>
        <button class="btn btn-ghost btn-sm" data-a="go" data-r="content" data-tab="${kind === 'idea' ? 'ideas' : kind === 'planning' ? 'plan' : 'board'}">${ic('arrow-left', 14)}${tr('Back')}</button>
        <h1><span class="key">${esc(item.key)}</span></h1>
      </div>
      <div class="acts">
        ${kind === 'idea' ? `<button class="btn btn-primary btn-sm" data-a="promoteIdea" data-id="${item.id}">${tr('Promote to planning')}</button>` : ''}
        ${kind === 'planning' ? `<button class="btn btn-primary btn-sm" data-a="startProduction" data-id="${item.id}">${tr('Start production')}</button>` : ''}
        <button class="btn btn-danger-ghost btn-sm" data-a="deletePiece" data-id="${item.id}">${tr('Delete piece')}</button>
      </div>
    </div>
    <div class="piece-layout">
      <section class="panel piece-brief">
        <input class="input piece-title" id="piece-title" data-in="contentField" data-blur="contentTitle" data-f="title" data-id="${item.id}" value="${esc(item.title)}" aria-label="${tr('Title')}" maxlength="200">
        <div class="piece-meta">
          <label class="field"><span class="label">${tr('Stage')}</span>
            <select class="select" data-in="contentField" data-f="stage" data-id="${item.id}" aria-label="${tr('Stage')}">${stages.map(s => `<option value="${s.id}" ${s.id === item.stage ? 'selected' : ''}>${esc(tr(stageLabel(s)))}</option>`).join('')}</select>
          </label>
          <label class="field"><span class="label">${tr('Format')}</span>
            <select class="select" data-in="contentField" data-f="format" data-id="${item.id}" aria-label="${tr('Format')}">${opts([['', tr('No format')], ...FORMATS.map(f => [f.id, tr(f.name)])], item.format)}</select>
          </label>
          <label class="field"><span class="label">${tr('Brand')}</span>
            <select class="select" data-in="contentField" data-f="brand" data-id="${item.id}" aria-label="${tr('Brand')}">${opts([['', tr('No brand')], ...BRANDS.map(b => [b.id, b.name])], item.brand)}</select>
          </label>
          <label class="field"><span class="label">${tr('Target date')}</span>
            <input class="input" type="date" data-in="contentField" data-f="target" data-id="${item.id}" value="${esc(item.target || '')}" aria-label="${tr('Target date')}">
          </label>
        </div>
        <label class="field"><span class="label">${tr('Theme')}</span>
          <span class="piece-inline"><input class="input" id="piece-theme" data-in="contentField" data-f="theme" data-id="${item.id}" value="${esc(item.theme)}" maxlength="80" aria-label="${tr('Theme')}"><button class="btn btn-ghost btn-sm" type="button" data-a="useTheme" data-id="${item.id}" data-v="${esc(THEME_PRESET)}">${esc(THEME_PRESET)}</button></span>
        </label>
        <label class="field"><span class="label">${tr('Tags')}</span>
          <input class="input" id="piece-tags" data-in="contentField" data-f="tags" data-id="${item.id}" value="${esc((item.tags || []).join(', '))}" placeholder="${tr('Tags, comma separated')}" aria-label="${tr('Tags')}">
        </label>
        <label class="field"><span class="label">${tr('Source')}</span>
          <input class="input" data-in="contentField" data-f="source" data-id="${item.id}" value="${esc(item.source)}" maxlength="500" aria-label="${tr('Source')}">
        </label>
        <div class="field"><span class="label">${tr('Channels')}</span>
          <div class="idea-channels" role="group" aria-label="${tr('Channels')}">
            ${CHANNELS.map(c => `<label class="checkline"><input type="checkbox" data-in="contentChannel" data-id="${item.id}" value="${c.id}" ${(item.channels || []).some(x => x.channel === c.id) ? 'checked' : ''}>${esc(tr(c.name))}</label>`).join('')}
          </div>
        </div>
        ${briefField(item, 'objective', tr('Objective'), tr('The thesis of this piece'))}
        ${briefField(item, 'audience', tr('Audience'), tr('Who this is for'))}
        ${briefField(item, 'hook', tr('Hook'), tr('The first line'))}
        ${briefField(item, 'pillar', tr('Pillar'), tr('Which pillar it belongs to'))}
        ${briefField(item, 'points', tr('Key points'), tr('One point per line'), 5)}
        ${briefField(item, 'cta', tr('CTA'), tr('What the reader should do'))}
      </section>
      <section class="panel piece-editor">
        <div class="dsec">
          <div class="dsec-h"><h3 id="piece-body-l">${tr('Body')}</h3>${rteToolbar('piece-body')}</div>
          <div class="rte"><div class="rte-body" id="piece-body" contenteditable="true" data-rte="${item.id}" data-rte-kind="content" data-ph="${tr('Write the piece…')}" role="textbox" aria-multiline="true" aria-labelledby="piece-body-l">${sanitizeHtml(item.body)}</div></div>
        </div>
        ${(item.channels || []).length ? `<h3 class="piece-ch-h">${tr('Channel versions')}</h3><p class="faint piece-ch-note">${tr('Leave a channel blank to publish the main body. Fill it when that network needs its own text.')}</p>` : ''}
        ${(item.channels || [])
          .map(ch => {
            const name = tr(channelLabel(ch.channel));
            const eid = `piece-ch-${ch.channel}`;
            return `<details class="piece-channel" ${ch.body ? 'open' : ''}>
              <summary>${esc(name)}</summary>
              <div class="dsec">
                <div class="dsec-h"><h3 id="${eid}-l">${esc(name)}</h3>${rteToolbar(eid)}</div>
                <div class="rte"><div class="rte-body" id="${eid}" contenteditable="true" data-rte="${item.id}" data-rte-kind="content" data-rte-channel="${ch.channel}" data-ph="${tr('Version for {channel}', { channel: name })}" role="textbox" aria-multiline="true" aria-labelledby="${eid}-l">${sanitizeHtml(ch.body)}</div></div>
              </div>
            </details>`;
          })
          .join('')}
      </section>
    </div>
  </div>`;
}

function briefField(item, field, label, placeholder, rows = 3) {
  return `<label class="field"><span class="label">${label}</span>
    <textarea class="textarea" rows="${rows}" data-in="contentField" data-f="${field}" data-id="${item.id}" placeholder="${esc(placeholder)}" aria-label="${esc(label)}">${esc(item[field] || '')}</textarea>
  </label>`;
}

function rteToolbar(id) {
  return `<div class="rte-tb" role="toolbar" aria-label="${tr('Formatting')}" aria-controls="${id}">
    ${[
      ['bold', 'bold', tr('Bold')],
      ['italic', 'italic', tr('Italic')],
      ['insertUnorderedList', 'list', tr('Bulleted list')],
      ['insertOrderedList', 'list-ordered', tr('Numbered list')],
      ['formatBlock:h3', 'heading', tr('Heading')],
      ['createLink', 'link', tr('Link')],
    ]
      .map(([c, i, n]) => `<button type="button" class="ibtn ibtn-xs" data-cmd="${c}" data-tip="${n}" aria-label="${n}">${ic(i, 13)}</button>`)
      .join('')}
  </div>`;
}
