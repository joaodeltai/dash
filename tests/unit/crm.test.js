import { describe, expect, it } from 'vitest';
import { diff, flatten, hydrate, normalize } from '../../src/data/mappers.js';
import { filterDeals, parseBrl, pipelineMetrics } from '../../src/core/crm.js';
import { ctx, ids, makeRows } from './fixtures.js';

const stateOf = data => ({ data, prefs: { name: 'Ana' }, views: {} });

function crmRows() {
  const rows = makeRows();
  rows.crm_stages = [
    { id: 'st-new', slug: 'new', name: 'New lead', kind: 'open', position: 0, color: 'gray' },
    { id: 'st-qual', slug: 'qualified', name: 'Qualified', kind: 'open', position: 1, color: 'blue' },
    { id: 'st-won', slug: 'won', name: 'Won', kind: 'won', position: 9, color: 'green' },
    { id: 'st-lost', slug: 'lost', name: 'Lost', kind: 'lost', position: 10, color: 'red' },
  ];
  rows.crm_companies = [
    {
      id: 'co1',
      name: 'Acme',
      domain: 'acme.com.br',
      segment: 'Contact center',
      size: '51-200',
      city: 'São Paulo',
      state: 'SP',
      source: 'outbound',
      notes: '',
      social_links: { linkedin: 'https://linkedin.com/company/acme', instagram: 'https://instagram.com/acme' },
      employee_count: 120,
      founded_year: 1998,
      offering: 'Operação de contact center',
      created_by_agent: '',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-02T00:00:00.000Z',
    },
  ];
  rows.crm_contacts = [
    {
      id: 'ct1',
      company_id: 'co1',
      name: 'Lia',
      role: 'Ops',
      email: 'lia@acme.com.br',
      phone: '+55 11 90000-0000',
      linkedin: 'https://linkedin.com/in/lia',
      email_source: 'site',
      phone_source: 'Apollo',
      linkedin_source: 'Sales Nav',
      notes: '',
      created_by_agent: 'sdr',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    },
  ];
  rows.crm_deals = [
    {
      id: 'd1',
      title: 'Rollout',
      company_id: 'co1',
      contact_id: 'ct1',
      stage_id: 'st-qual',
      value_cents: 1500000,
      source: 'outbound',
      intent_score: 72,
      owner_id: ids.me,
      next_step: 'Send proposal',
      next_step_on: '2026-03-20',
      expected_close: '2026-04-01',
      lost_reason: '',
      tags: ['quente', 'inbound'],
      position: 2,
      created_by_agent: '',
      won_at: null,
      lost_at: null,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-08T00:00:00.000Z',
    },
  ];
  rows.crm_activities = [
    {
      id: 'ca1',
      deal_id: 'd1',
      company_id: 'co1',
      contact_id: 'ct1',
      type: 'note',
      direction: 'internal',
      content: 'Spoke with Lia',
      occurred_at: '2026-03-08T12:00:00.000Z',
      author_id: ids.me,
      created_by_agent: '',
      meta: {},
      message_variant: 'nao-entra',
    },
    {
      id: 'ca2',
      deal_id: 'd1',
      company_id: 'co1',
      contact_id: 'ct1',
      type: 'email',
      direction: 'outbound',
      content: 'Oi Lia',
      occurred_at: '2026-03-09T12:00:00.000Z',
      author_id: ids.me,
      created_by_agent: 'sdr',
      meta: {},
      message_variant: 'custo-v3',
    },
  ];
  rows.crm_research = [
    {
      id: 'r1',
      deal_id: 'd1',
      company_id: 'co1',
      contact_id: 'ct1',
      icp_decision: 'Keep',
      icp_reason: 'Cabe no ICP',
      why_them: 'Operação grande',
      why_now: 'Troca de fornecedor',
      trigger_event: 'Contrato vence',
      trigger_event_on: '2026-03-01',
      angle: 'Custo da operação atual',
      proofs: 'Vaga aberta de operações',
      do_not_mention: 'Preço de lista',
      confidence: 'A',
      gaps: ['faturamento', '[FALTA: decisor]'],
      icp_fit: 24,
      buying_power: 16,
      intent_signal: 20,
      angle_quality: 12,
      score_cutoff: 65,
      scored_at: '2026-03-08T00:00:00.000Z',
      created_by_agent: 'pesquisador',
      created_at: '2026-03-08T00:00:00.000Z',
      updated_at: '2026-03-08T00:00:00.000Z',
    },
  ];
  rows.crm_sequences = [
    {
      id: 'sq1',
      name: 'Follow-up',
      description: 'After the diagnosis',
      active: true,
      created_by_agent: '',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
    },
  ];
  rows.crm_sequence_steps = [{ id: 'sp1', sequence_id: 'sq1', position: 0, channel: 'whatsapp', delay_days: 2, body: 'Oi' }];
  rows.crm_sequence_enrollments = [
    { id: 'en1', sequence_id: 'sq1', deal_id: 'd1', status: 'active', step_index: 0, next_on: '2026-03-22', created_by_agent: '' },
  ];
  return rows;
}

describe('parseBrl', () => {
  it('reads Brazilian and US groupings as cents', () => {
    expect(parseBrl('')).toBe(0);
    expect(parseBrl('  R$ 12.500,50 ')).toBe(1250050);
    expect(parseBrl('12,500.50')).toBe(1250050);
    expect(parseBrl('12.500')).toBe(1250000);
    expect(parseBrl('12.50')).toBe(1250);
    expect(parseBrl('nope')).toBeNull();
    expect(parseBrl('-10')).toBeNull();
  });
});

describe('pipeline metrics and filters', () => {
  const stages = [
    { id: 'a', name: 'New lead', kind: 'open', position: 0 },
    { id: 'b', name: 'Qualified', kind: 'open', position: 1 },
    { id: 'w', name: 'Won', kind: 'won', position: 2 },
    { id: 'l', name: 'Lost', kind: 'lost', position: 3 },
  ];
  const deals = [
    { id: '1', stage: 'a', value: 100, wonAt: null, title: 'Alpha', company: 'co', tags: ['x'], owner: 'm', source: 'outbound', nextOn: '2026-03-01' },
    { id: '2', stage: 'b', value: 200, wonAt: null, title: 'Beta', company: 'co', tags: [], owner: 'm', source: 'inbound', nextOn: '2026-04-01' },
    {
      id: '3',
      stage: 'w',
      value: 400,
      wonAt: Date.parse('2026-03-15T00:00:00Z'),
      title: 'Won one',
      company: null,
      tags: [],
      owner: null,
      source: '',
      nextOn: null,
    },
    { id: '4', stage: 'l', value: 50, wonAt: null, title: 'Lost one', company: null, tags: [], owner: null, source: '', nextOn: '2020-01-01' },
  ];

  it('counts the open pipeline, wins this month and the funnel', () => {
    const m = pipelineMetrics(deals, stages, new Date('2026-03-20T00:00:00Z'));
    expect(m.openValue).toBe(300);
    expect(m.openN).toBe(2);
    expect(m.wonMonth).toBe(400);
    expect(m.wonMonthN).toBe(1);
    expect(m.winRate).toBe(0.5);
    expect(m.conversions.map(c => [c.from.id, c.to.id, c.toN, c.fromN])).toEqual([
      ['a', 'b', 2, 3],
      ['b', 'w', 1, 2],
    ]);
  });

  it('filters by tag, owner, overdue and text', () => {
    const opt = { stages, companies: [{ id: 'co', name: 'Acme', domain: '' }], contacts: [], today: '2026-03-10' };
    expect(filterDeals(deals, { ...opt, tag: 'x' }).map(d => d.id)).toEqual(['1']);
    expect(filterDeals(deals, { ...opt, owner: 'none' }).map(d => d.id)).toEqual(['3', '4']);
    expect(filterDeals(deals, { ...opt, overdue: true }).map(d => d.id)).toEqual(['1']);
    expect(filterDeals(deals, { ...opt, q: 'acme' }).map(d => d.id)).toEqual(['1', '2']);
  });
});

describe('CRM mappers', () => {
  it('round-trips companies, contacts, deals, activities, sequences and enrollments', () => {
    const first = flatten(stateOf(hydrate(crmRows(), ctx).data), ctx);
    const back = {
      ...crmRows(),
      crm_stages: [...first.crm_stages.values()],
      crm_companies: [...first.crm_companies.values()],
      crm_contacts: [...first.crm_contacts.values()],
      crm_deals: [...first.crm_deals.values()],
      crm_research: [...first.crm_research.values()],
      crm_activities: [...first.crm_activities.values()],
      crm_sequences: [...first.crm_sequences.values()],
      crm_sequence_steps: [...first.crm_sequence_steps.values()],
      crm_sequence_enrollments: [...first.crm_sequence_enrollments.values()],
    };
    const second = flatten(stateOf(hydrate(back, ctx).data), ctx);
    expect(diff(first, second)).toEqual({ ops: {}, count: 0 });
    expect(first.crm_deals.get('d1')).toMatchObject({ value_cents: 1500000, intent_score: 72, stage_id: 'st-qual', tags: ['quente', 'inbound'] });
    expect(first.crm_companies.get('co1')).toMatchObject({
      social_links: { instagram: 'https://instagram.com/acme', linkedin: 'https://linkedin.com/company/acme' },
      employee_count: 120,
      founded_year: 1998,
      offering: 'Operação de contact center',
    });
    expect(first.crm_contacts.get('ct1')).toMatchObject({ email_source: 'site', phone_source: 'Apollo', linkedin_source: 'Sales Nav' });
    expect(first.crm_activities.get('ca1').message_variant).toBe('');
    expect(first.crm_activities.get('ca2')).toMatchObject({ message_variant: 'custo-v3', type: 'email', direction: 'outbound' });
    const research = first.crm_research.get('r1');
    expect(research.intent_score).toBeUndefined();
    expect(research).toMatchObject({
      icp_decision: 'keep',
      confidence: 'high',
      gaps: ['[FALTA: faturamento]', '[FALTA: decisor]'],
      icp_fit: 24,
      buying_power: 16,
      intent_signal: 20,
      angle_quality: 12,
      score_cutoff: 65,
    });
    expect(research.icp_fit + research.buying_power + research.intent_signal + research.angle_quality).toBe(72);
    expect(first.crm_sequence_steps.get('sp1')).toMatchObject({ channel: 'whatsapp', delay_days: 2, sequence_id: 'sq1' });
    expect([...first.crm_sequences.values()][0].workspace_id).toBe(ids.ws);
  });

  it('does not persist a pending stage-change activity', () => {
    const { data } = hydrate(crmRows(), ctx);
    data.crmActivities.push({
      id: 'pending',
      deal: 'd1',
      type: 'stage_change',
      direction: 'internal',
      content: '',
      at: 10,
      by: ids.me,
      agent: '',
      meta: { from: 'st-new', to: 'st-qual' },
      pending: true,
    });
    normalize(data);
    const flat = flatten(stateOf(data), ctx);
    expect(flat.crm_activities.has('pending')).toBe(false);
    expect(flat.crm_activities.has('ca1')).toBe(true);
  });

  it('drops a deal whose stage is gone and clears a contact left behind by a deleted company', () => {
    const { data } = hydrate(crmRows(), ctx);
    data.deals.push({ id: 'ghost', stage: 'missing', title: 'Nope', tags: [], value: 0, intent: 0, order: 0 });
    data.companies = data.companies.filter(c => c.id !== 'co1');
    normalize(data);
    expect(data.deals.map(d => d.id)).toEqual(['d1']);
    expect(data.deals[0].company).toBeNull();
    expect(data.contacts[0].company).toBeNull();
    expect(data.crmActivities.map(a => a.id).sort()).toEqual(['ca1', 'ca2']);
    expect(data.research.map(r => r.id)).toEqual(['r1']);
    expect(data.research[0].company).toBeNull();
  });

  it('leaves the new columns out of the write while the prospecting migration is not applied', () => {
    const { data } = hydrate(crmRows(), ctx);
    data.crmProspecting = false;
    const flat = flatten(stateOf(data), ctx);
    expect(flat.crm_companies.get('co1').social_links).toBeUndefined();
    expect(flat.crm_companies.get('co1').offering).toBeUndefined();
    expect(flat.crm_contacts.get('ct1').email_source).toBeUndefined();
    expect(flat.crm_activities.get('ca2').message_variant).toBeUndefined();
    expect(flat.crm_research.size).toBe(0);
    expect(flat.crm_deals.get('d1').intent_score).toBe(72);
  });
});
