import { describe, expect, it } from 'vitest';
import { as, available, denied, id, okOf, query, world } from './helpers.js';

const stage = slug => query(`select id from public.crm_stages where workspace_id = '${world.wsA}' and slug = '${slug}'`)[0].id;

describe.skipIf(!available)('crm', () => {
  it('members read the pipeline and guests do not', async () => {
    expect(okOf(await as('mem').from('crm_deals').select('id').eq('id', world.seed.deal))).toHaveLength(1);
    expect(okOf(await as('gst').from('crm_deals').select('id'))).toEqual([]);
    expect(okOf(await as('gst').from('crm_companies').select('id'))).toEqual([]);
    denied(await as('gst').from('crm_companies').insert({ workspace_id: world.wsA, name: 'Nope' }));
  });

  it('a lost deal without a reason is rejected, and a stage change is logged once', async () => {
    const dealId = id();
    okOf(
      await as('a')
        .from('crm_deals')
        .insert({ id: dealId, workspace_id: world.wsA, title: 'Move me', stage_id: stage('new') }),
    );
    denied(
      await as('a')
        .from('crm_deals')
        .update({ stage_id: stage('lost') })
        .eq('id', dealId),
    );
    expect(query(`select stage_id from public.crm_deals where id = '${dealId}'`)[0].stage_id).toBe(stage('new'));

    okOf(
      await as('a')
        .from('crm_deals')
        .update({ stage_id: stage('qualified') })
        .eq('id', dealId),
    );
    const logs = query(`select meta from public.crm_activities where deal_id = '${dealId}' and type = 'stage_change'`);
    expect(logs).toHaveLength(1);
    expect(logs[0].meta.from).toBe(stage('new'));
    expect(logs[0].meta.to).toBe(stage('qualified'));

    okOf(
      await as('a')
        .from('crm_deals')
        .update({ stage_id: stage('lost'), lost_reason: 'No budget' })
        .eq('id', dealId),
    );
    expect(query(`select lost_reason, lost_at is not null as lost from public.crm_deals where id = '${dealId}'`)[0]).toMatchObject({
      lost_reason: 'No budget',
      lost: true,
    });
  });

  it('does not log a second stage change when the client already recorded the same move', async () => {
    const dealId = id();
    const from = stage('new');
    const to = stage('researched');
    okOf(await as('a').from('crm_deals').insert({ id: dealId, workspace_id: world.wsA, title: 'Already logged', stage_id: from }));
    okOf(await as('a').from('crm_activities').insert({ deal_id: dealId, type: 'stage_change', direction: 'internal', content: '', meta: { from, to } }));
    okOf(await as('a').from('crm_deals').update({ stage_id: to }).eq('id', dealId));
    expect(query(`select count(*)::int as n from public.crm_activities where deal_id = '${dealId}' and type = 'stage_change'`)[0].n).toBe(1);
  });

  it('refuses a contact that belongs to another workspace', async () => {
    const dealId = id();
    const contactId = id();
    okOf(
      await as('a')
        .from('crm_deals')
        .insert({ id: dealId, workspace_id: world.wsA, title: 'Local', stage_id: stage('new') }),
    );
    okOf(await as('b').from('crm_contacts').insert({ id: contactId, workspace_id: world.wsB, name: 'Bea contact' }));
    denied(await as('a').from('crm_deals').update({ contact_id: contactId }).eq('id', dealId));
    expect(query(`select contact_id from public.crm_deals where id = '${dealId}'`)[0].contact_id).toBeNull();
  });
});
