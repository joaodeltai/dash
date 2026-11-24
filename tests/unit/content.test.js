import { describe, expect, it } from 'vitest';
import { flatten, hydrate } from '../../src/data/mappers.js';
import { boardStages, filterItems, stageBySlug } from '../../src/core/content.js';
import { ctx, makeRows } from './fixtures.js';

const stateOf = data => ({ data, prefs: { name: 'Ana' }, views: {} });

function rows() {
  const base = makeRows();
  base.content_stages = [
    { id: 'cs-ideas', slug: 'ideas', name: 'Ideas', kind: 'idea', position: 0, color: 'gray' },
    { id: 'cs-plan', slug: 'planning', name: 'Planning', kind: 'planning', position: 1, color: 'blue' },
    { id: 'cs-unload', slug: 'unload', name: 'Unload', kind: 'production', position: 2, color: 'violet' },
    { id: 'cs-record', slug: 'record', name: 'Record', kind: 'production', position: 5, color: 'orange' },
    { id: 'cs-edit', slug: 'edit', name: 'Edit', kind: 'production', position: 6, color: 'rose' },
    { id: 'cs-posted', slug: 'posted', name: 'Posted', kind: 'published', position: 8, color: 'green' },
  ];
  base.content_items = [
    {
      id: 'piece-1',
      stage_id: 'cs-ideas',
      key: 'PEC-1',
      title: 'Por que o líder some',
      source: 'https://example.com/nota',
      format: 'short',
      brand: 'deltai',
      theme: 'Build in public',
      tags: ['liderança'],
      objective: 'A tese',
      audience: 'Fundadores',
      hook: 'A primeira linha',
      pillar: 'O líder',
      key_points: 'um\ndois',
      cta: 'Comenta',
      body: '<p>Oi</p>',
      target_on: '2026-03-20',
      trello_card_id: '',
      position: 1,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-02T00:00:00.000Z',
    },
    {
      id: 'piece-2',
      stage_id: 'cs-unload',
      key: 'PEC-2',
      title: 'Thread da semana',
      source: '',
      format: 'social',
      brand: 'fync',
      theme: '',
      tags: [],
      objective: '',
      audience: '',
      hook: '',
      pillar: '',
      key_points: '',
      cta: '',
      body: '',
      target_on: null,
      trello_card_id: '',
      position: 2,
      created_at: '2026-03-03T00:00:00.000Z',
      updated_at: '2026-03-03T00:00:00.000Z',
    },
  ];
  base.content_item_channels = [
    { id: 'ch-1', item_id: 'piece-1', channel: 'linkedin', body: '' },
    { id: 'ch-2', item_id: 'piece-1', channel: 'x', body: 'versão curta' },
    { id: 'ch-3', item_id: 'piece-2', channel: 'threads', body: '' },
  ];
  return base;
}

describe('content mappers', () => {
  it('hydrates a piece with its channels and flattens back to the same rows', () => {
    const { data } = hydrate(rows(), ctx);
    const piece = data.contentItems.find(i => i.id === 'piece-1');
    expect(piece).toMatchObject({
      key: 'PEC-1',
      stage: 'cs-ideas',
      format: 'short',
      brand: 'deltai',
      theme: 'Build in public',
      tags: ['liderança'],
      objective: 'A tese',
      points: 'um\ndois',
      target: '2026-03-20',
    });
    expect(piece.channels.map(c => c.channel)).toEqual(['linkedin', 'x']);
    expect(piece.channels.find(c => c.channel === 'x').body).toBe('versão curta');

    const flat = flatten(stateOf(data), ctx);
    expect(flat.content_items.get('piece-1')).toMatchObject({
      key: 'PEC-1',
      stage_id: 'cs-ideas',
      brand: 'deltai',
      key_points: 'um\ndois',
      target_on: '2026-03-20',
    });
    expect(flat.content_item_channels.get('ch-2')).toMatchObject({ item_id: 'piece-1', channel: 'x', body: 'versão curta' });
    expect(stageBySlug(data.contentStages, 'record').kind).toBe('production');
  });

  it('drops a channel the database would refuse and a piece whose stage is gone', () => {
    const source = rows();
    source.content_item_channels.push({ id: 'ch-bad', item_id: 'piece-1', channel: 'tiktok', body: '' });
    source.content_items.push({ ...source.content_items[0], id: 'piece-x', stage_id: 'missing', key: 'PEC-9', title: 'Solta' });
    const { data } = hydrate(source, ctx);
    const piece = data.contentItems.find(i => i.id === 'piece-1');
    expect(piece.channels.map(c => c.channel)).toEqual(['linkedin', 'x']);
    expect(data.contentItems.some(i => i.id === 'piece-x')).toBe(false);
  });

  it('does not write content rows when the migration is not applied yet', () => {
    const source = rows();
    source.contentReady = false;
    const { data } = hydrate(source, ctx);
    expect(data.contentReady).toBe(false);
    const flat = flatten(stateOf(data), ctx);
    expect(flat.content_items.size).toBe(0);
    expect(flat.content_stages.size).toBe(0);
  });
});

describe('content filters', () => {
  const stages = [
    { id: 'ideas', slug: 'ideas', kind: 'idea', position: 0 },
    { id: 'unload', slug: 'unload', kind: 'production', position: 2 },
    { id: 'record', slug: 'record', kind: 'production', position: 5 },
    { id: 'edit', slug: 'edit', kind: 'production', position: 6 },
    { id: 'posted', slug: 'posted', kind: 'published', position: 8 },
  ];
  const items = [
    {
      id: 'a',
      title: 'Líder',
      format: 'short',
      brand: 'deltai',
      theme: 'Build in public',
      tags: [],
      target: '2026-03-01',
      channels: [{ channel: 'linkedin' }],
    },
    {
      id: 'b',
      title: 'Thread',
      format: 'social',
      brand: 'fync',
      theme: '',
      tags: ['venda'],
      target: null,
      channels: [{ channel: 'x' }, { channel: 'threads' }],
    },
  ];

  it('keeps Gravar and Editar on the board and leaves ideas off it', () => {
    expect(boardStages(stages).map(s => s.slug)).toEqual(['unload', 'record', 'edit', 'posted']);
  });

  it('filters by brand, channel, theme and text', () => {
    expect(filterItems(items, { brand: 'fync' }).map(i => i.id)).toEqual(['b']);
    expect(filterItems(items, { channel: 'threads' }).map(i => i.id)).toEqual(['b']);
    expect(filterItems(items, { theme: 'preset' }).map(i => i.id)).toEqual(['a']);
    expect(filterItems(items, { q: 'venda' }).map(i => i.id)).toEqual(['b']);
    expect(filterItems(items, { when: 'undated', today: '2026-03-10' }).map(i => i.id)).toEqual(['b']);
    expect(filterItems(items, { when: 'overdue', today: '2026-03-10' }).map(i => i.id)).toEqual(['a']);
  });
});
