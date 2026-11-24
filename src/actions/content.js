/* Content mutations. They change S.data and save(), the same way tasks and deals do. */
import { $, uid } from '../core/utils.js';
import { tr } from '../core/i18n.js';
import { CHANNELS, THEME_PRESET, stageByKind, stageBySlug, stageLabel } from '../core/content.js';
import { D, S, canCreate, contentItem, contentStage, contentStages, save } from '../core/store.js';
import { mutate, toast } from '../ui/toast.js';
import { fxSet, go, render } from '../shell/render.js';
import { A, BLUR, IN, confirmDlg } from './actions.js';

const now = () => Date.now();

function nextPieceKey() {
  let n = 0;
  for (const item of D().contentItems || []) {
    const m = /^PEC-(\d+)$/.exec(item.key || '');
    if (m) n = Math.max(n, Number(m[1]));
  }
  return 'PEC-' + (n + 1);
}

function orderAtEnd(stageId) {
  const col = (D().contentItems || []).filter(x => x.stage === stageId);
  return col.length ? Math.max(...col.map(x => x.order || 0)) + 1 : 1;
}

export function blankPiece(over = {}) {
  return {
    id: uid(),
    key: nextPieceKey(),
    stage: null,
    title: '',
    source: '',
    format: '',
    brand: '',
    theme: '',
    tags: [],
    objective: '',
    audience: '',
    hook: '',
    pillar: '',
    points: '',
    cta: '',
    body: '',
    target: null,
    trello: '',
    order: 0,
    channels: [],
    created: now(),
    updated: now(),
    ...over,
  };
}

function ready() {
  if (D().contentReady === false) {
    toast(tr('Apply the content migration before adding pieces.'), { kind: 'err' });
    return false;
  }
  if (!canCreate()) {
    toast(tr('Guests cannot change content.'), { kind: 'err' });
    return false;
  }
  return true;
}

function withChannels(channels) {
  const want = new Set((channels || []).filter(id => CHANNELS.some(c => c.id === id)));
  return [...want].map(channel => ({ id: uid(), channel, body: '' }));
}

export function movePiece(item, stageId, order) {
  const stage = contentStage(stageId);
  if (!item || !stage) return false;
  item.stage = stage.id;
  if (order != null) item.order = order;
  item.updated = now();
  return true;
}

function orderInColumn(stageId, beforeId, selfId, fallback) {
  const col = (D().contentItems || []).filter(x => x.stage === stageId && x.id !== selfId).sort((a, b) => a.order - b.order);
  if (!beforeId) return col.length ? col[col.length - 1].order + 1 : fallback;
  const i = col.findIndex(x => x.id === beforeId);
  if (i < 0) return fallback;
  const prev = col[i - 1];
  const nx = col[i];
  return prev ? (prev.order + nx.order) / 2 : nx.order - 1;
}

const draft = () => (S.ui.ideaDraft = S.ui.ideaDraft || { title: '', source: '', format: '', brand: '', theme: '', tags: '', channels: [] });

IN.ideaDraft = el => {
  const d = draft();
  if (el.dataset.f === 'channel') {
    const set = new Set(d.channels || []);
    if (el.checked) set.add(el.value);
    else set.delete(el.value);
    d.channels = [...set];
    return;
  }
  d[el.dataset.f] = el.value;
};

A.ideaTheme = el => {
  const d = draft();
  d.theme = el.dataset.v || '';
  render();
};

A.createIdea = () => {
  if (!ready()) return;
  const d = draft();
  const title = ($('#idea-title')?.value ?? d.title ?? '').trim();
  const source = ($('#idea-source')?.value ?? d.source ?? '').trim();
  const format = $('#idea-format')?.value ?? d.format ?? '';
  const brand = $('#idea-brand')?.value ?? d.brand ?? '';
  const theme = ($('#idea-theme')?.value ?? d.theme ?? '').trim();
  const tags = ($('#idea-tags')?.value ?? d.tags ?? '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  const stage = stageBySlug(contentStages(), 'ideas') || stageByKind(contentStages(), 'idea');
  if (!stage) {
    toast(tr('The idea stage is missing. Reload if you just applied the migration.'), { kind: 'err' });
    return;
  }
  if (!title) {
    toast(tr('Give the idea a title'), { kind: 'info' });
    $('#idea-title')?.focus();
    return;
  }
  const item = blankPiece({
    title,
    source,
    format,
    brand,
    theme,
    tags,
    stage: stage.id,
    order: orderAtEnd(stage.id),
    channels: withChannels(d.channels),
  });
  if (
    !mutate(() => {
      D().contentItems.push(item);
      S.ui.ideaDraft = null;
      fxSet({ added: item.id });
    })
  )
    return;
  toast(tr('Idea saved'), { ms: 1800 });
};

A.promoteIdea = el => {
  if (!ready()) return;
  const item = contentItem(el.dataset.id);
  const stage = stageBySlug(contentStages(), 'planning') || stageByKind(contentStages(), 'planning');
  if (!item || !stage) return;
  if (!mutate(() => movePiece(item, stage.id, orderAtEnd(stage.id)))) return;
  toast(tr('“{title}” is in planning', { title: item.title }), { ms: 2000 });
  go('content', { id: item.id });
};

A.startProduction = el => {
  if (!ready()) return;
  const item = contentItem(el.dataset.id);
  const stage = stageBySlug(contentStages(), 'unload') || stageByKind(contentStages(), 'production');
  if (!item || !stage) return;
  if (!mutate(() => movePiece(item, stage.id, orderAtEnd(stage.id)))) return;
  toast(tr('Moved “{title}” to {stage}', { title: item.title, stage: tr(stageLabel(stage)) }), { ms: 2000 });
};

A.openPiece = el => {
  const item = contentItem(el.dataset.id);
  if (!item) return;
  go('content', { id: item.id });
};

A.addPiece = el => {
  if (!ready()) return;
  const stage = contentStage(el.dataset.stage) || stageBySlug(contentStages(), 'unload');
  if (!stage) return;
  const item = blankPiece({ title: tr('Untitled'), stage: stage.id, order: orderAtEnd(stage.id) });
  if (!mutate(() => D().contentItems.push(item))) return;
  go('content', { id: item.id });
};

A.deletePiece = el => {
  const item = contentItem(el.dataset.id);
  if (!item || !ready()) return;
  confirmDlg({
    title: tr('Delete this piece?'),
    body: tr('The piece, its brief and its channel versions will be permanently deleted.'),
    ok: tr('Delete piece'),
    danger: true,
    run: () => {
      const kind = contentStage(item.stage)?.kind;
      if (
        !mutate(() => {
          D().contentItems = D().contentItems.filter(x => x.id !== item.id);
        })
      )
        return;
      go('content', { tab: kind === 'idea' ? 'ideas' : kind === 'planning' ? 'plan' : 'board' });
    },
  });
};

IN.contentField = el => {
  const item = contentItem(el.dataset.id);
  if (!item) return;
  const f = el.dataset.f;
  if (f === 'stage') {
    if (el.value && el.value !== item.stage) movePiece(item, el.value, orderAtEnd(el.value));
  } else if (f === 'tags')
    item.tags = el.value
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
  else if (f === 'title') {
    const title = el.value.replace(/\s+/g, ' ').trim();
    if (title) item.title = title.slice(0, 200);
  } else if (f === 'target') item.target = el.value || null;
  else item[f] = el.value;
  item.updated = now();
  save();
  if (el.matches('select, input[type=date]')) render();
};

BLUR.contentTitle = el => {
  const item = contentItem(el.dataset.id);
  if (!item) return;
  if (!el.value.trim()) el.value = item.title;
};

IN.contentChannel = el => {
  const item = contentItem(el.dataset.id);
  if (!item) return;
  const id = el.value;
  if (!CHANNELS.some(c => c.id === id)) return;
  if (el.checked) {
    if (!item.channels.some(c => c.channel === id)) item.channels.push({ id: uid(), channel: id, body: '' });
  } else item.channels = item.channels.filter(c => c.channel !== id);
  item.updated = now();
  save();
  render();
};

IN.contentQ = el => {
  S.ui.contentQ = el.value;
  render();
};

IN.contentFilter = el => {
  S.ui.contentFilter = Object.assign({ format: 'all', brand: 'all', theme: 'all', channel: 'all', when: 'all' }, S.ui.contentFilter);
  S.ui.contentFilter[el.dataset.f] = el.value;
  render();
};

A.clearContentFilters = () => {
  S.ui.contentQ = '';
  S.ui.contentFilter = { format: 'all', brand: 'all', theme: 'all', channel: 'all', when: 'all' };
  render();
};

A.useTheme = el => {
  const item = contentItem(el.dataset.id);
  if (!item) return;
  const theme = el.dataset.v || THEME_PRESET;
  mutate(() => {
    item.theme = theme;
    item.updated = now();
  });
};

export function dropPiece(id, stageId, beforeId) {
  const item = contentItem(id);
  const stage = contentStage(stageId);
  if (!item || !stage || stage.kind === 'idea' || stage.kind === 'planning') return;
  const order = orderInColumn(stageId, beforeId, item.id, item.order);
  if (item.stage === stageId && order === item.order) return;
  const from = item.stage;
  fxSet({ moved: item.id });
  if (!mutate(() => movePiece(item, stageId, order))) return;
  if (from !== stageId) toast(tr('Moved “{title}” to {stage}', { title: item.title, stage: tr(stageLabel(stage)) }), { ms: 2200 });
}
