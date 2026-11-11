import { describe, expect, it } from 'vitest';
import { as, available, denied, id, inviteAs, memberId, newUser, okOf, query, rowsOf, sql, tag, user, world } from './helpers.js';

const emailFor = label => `it-${world.run}-${label}-${tag()}@dash-it.test`;
const memberByEmail = email => rowsOf('members', { workspace_id: world.wsA, email })[0];

describe.skipIf(!available)('invitations', () => {
  it('an admin-level user invites an e-mail: a pending member row with no account attached', async () => {
    const email = emailFor('inv1');
    const mid = await inviteAs('a', { email, name: 'Pending Pat', role: 'member' });
    expect(memberByEmail(email)).toMatchObject({
      id: mid,
      status: 'invited',
      user_id: null,
      role: 'member',
      name: 'Pending Pat',
      invited_by: user('a').id,
      workspace_id: world.wsA,
    });
  });

  it('the invited person creates an account, claim_invitations makes them an active member, and only once', async () => {
    const c = await newUser('claim', 'Cleo Claimed');
    const mid = await inviteAs('a', { email: c.email, name: 'Placeholder Name', role: 'member' });
    const bystander = emailFor('bystander');
    const bystanderId = await inviteAs('a', { email: bystander, name: 'Bystander', role: 'guest' });

    // before claiming they are not in the workspace
    expect(okOf(await c.client.from('workspaces').select('id').eq('id', world.wsA))).toEqual([]);
    expect(okOf(await c.client.from('projects').select('id').eq('workspace_id', world.wsA))).toEqual([]);

    expect(okOf(await c.client.rpc('claim_invitations'))).toBe(1);
    expect(memberByEmail(c.email)).toMatchObject({ id: mid, user_id: c.id, status: 'active', role: 'member', name: 'Cleo Claimed' });
    expect(memberByEmail(c.email).last_seen_at).toBeTruthy();
    // an invitation for somebody else's address stays untouched
    expect(memberByEmail(bystander)).toMatchObject({ id: bystanderId, status: 'invited', user_id: null });

    // now they can see the workspace; as a plain member they can also read its projects
    expect(okOf(await c.client.from('workspaces').select('id').eq('id', world.wsA))).toHaveLength(1);
    expect(okOf(await c.client.from('members').select('id').eq('workspace_id', world.wsA)).length).toBeGreaterThan(5);
    // second call finds nothing left to claim
    expect(okOf(await c.client.rpc('claim_invitations'))).toBe(0);
  });

  it('an account whose e-mail is not confirmed is not linked to the invitation (and gets linked once confirmed)', async () => {
    const d = await newUser('unconf', 'Dana Unconfirmed');
    const mid = await inviteAs('a', { email: d.email, name: 'Dana', role: 'member' });
    sql(`update auth.users set email_confirmed_at = null where id = '${d.id}'`);
    try {
      expect(okOf(await d.client.rpc('claim_invitations'))).toBe(0);
      expect(rowsOf('members', { id: mid })[0]).toMatchObject({ status: 'invited', user_id: null });
      expect(okOf(await d.client.from('workspaces').select('id').eq('id', world.wsA))).toEqual([]);
    } finally {
      sql(`update auth.users set email_confirmed_at = now() where id = '${d.id}'`);
    }
    expect(okOf(await d.client.rpc('claim_invitations'))).toBe(1);
    expect(rowsOf('members', { id: mid })[0]).toMatchObject({ status: 'active', user_id: d.id });
  });

  it("a different account cannot claim somebody else's invitation", async () => {
    const email = emailFor('other');
    const mid = await inviteAs('a', { email, role: 'member' });
    expect(okOf(await as('b').rpc('claim_invitations'))).toBe(0);
    expect(okOf(await as('mem2').rpc('claim_invitations'))).toBe(0);
    expect(rowsOf('members', { id: mid })[0]).toMatchObject({ status: 'invited', user_id: null });
  });

  describe('what an invitation may look like', () => {
    const row = (over = {}) => ({ id: id(), workspace_id: world.wsA, email: emailFor('shape'), name: 'Shape', role: 'member', status: 'invited', ...over });
    const noRowFor = email => expect(query(`select count(*)::int as n from public.members where email = '${email}'`)[0].n).toBe(0);

    it.each(['a', 'adm', 'mem'])('%s cannot create an already active member', async who => {
      const r = row({ status: 'active' });
      denied(await as(who).from('members').insert(r), '42501');
      noRowFor(r.email);
    });

    it.each(['a', 'adm', 'mem'])('%s cannot create a deactivated member', async who => {
      const r = row({ status: 'deactivated' });
      denied(await as(who).from('members').insert(r), '42501');
      noRowFor(r.email);
    });

    it.each(['a', 'adm', 'mem'])('%s cannot attach an account (user_id) to an invitation', async who => {
      const r = row({ user_id: user('b').id });
      denied(await as(who).from('members').insert(r), '42501');
      noRowFor(r.email);
    });

    it.each(['a', 'adm', 'mem'])('%s cannot invite an owner', async who => {
      const r = row({ role: 'owner' });
      denied(await as(who).from('members').insert(r), '42501');
      noRowFor(r.email);
    });

    it('a Member cannot invite an Admin, but can invite a Member or a Guest', async () => {
      const bad = row({ role: 'admin' });
      denied(await as('mem').from('members').insert(bad), '42501');
      noRowFor(bad.email);
      okOf(
        await as('mem')
          .from('members')
          .insert(row({ role: 'member' })),
      );
      okOf(
        await as('mem')
          .from('members')
          .insert(row({ role: 'guest' })),
      );
    });

    it('an Admin and the Owner can invite an Admin', async () => {
      okOf(
        await as('adm')
          .from('members')
          .insert(row({ role: 'admin' })),
      );
      okOf(
        await as('a')
          .from('members')
          .insert(row({ role: 'admin' })),
      );
    });

    it('a Guest cannot invite anyone', async () => {
      const r = row({ role: 'guest' });
      denied(await as('gst').from('members').insert(r));
      noRowFor(r.email);
    });

    it('the inviter is recorded by the database, whatever the client sends', async () => {
      const r = row({ invited_by: user('a').id });
      okOf(await as('mem').from('members').insert(r));
      expect(rowsOf('members', { id: r.id })[0].invited_by).toBe(user('mem').id);
    });

    it('the same e-mail cannot be invited twice into one workspace', async () => {
      const first = row();
      okOf(await as('a').from('members').insert(first));
      denied(
        await as('a')
          .from('members')
          .insert(row({ email: first.email })),
        '23505',
      );
    });

    it('an e-mail with capital letters is refused (the column is lower case only)', async () => {
      denied(
        await as('a')
          .from('members')
          .insert(row({ email: `UPPER-${tag()}@Dash-IT.test` })),
        '23514',
      );
    });

    it('an outsider cannot invite into workspace A', async () => {
      const r = row({ role: 'guest' });
      denied(await as('b').from('members').insert(r));
      noRowFor(r.email);
    });
  });

  describe('withdrawing an invitation', () => {
    it('the person who invited can delete it; other members cannot; admins can', async () => {
      const email = emailFor('del');
      const mid = id();
      okOf(await as('mem').from('members').insert({ id: mid, workspace_id: world.wsA, email, name: 'Del', role: 'member', status: 'invited' }));
      // another plain member: nothing is deleted
      const other = await as('mem2').from('members').delete().eq('id', mid).select();
      expect(other.data ?? []).toEqual([]);
      expect(rowsOf('members', { id: mid })).toHaveLength(1);
      // the inviter
      expect(okOf(await as('mem').from('members').delete().eq('id', mid).select())).toHaveLength(1);
      // an admin can remove somebody else's invitation
      const mid2 = await inviteAs('mem', { email: emailFor('del2') });
      expect(okOf(await as('adm').from('members').delete().eq('id', mid2).select())).toHaveLength(1);
      expect(rowsOf('members', { id: mid2 })).toHaveLength(0);
    });

    it('a guest or an outsider cannot delete an invitation', async () => {
      const mid = await inviteAs('a', { email: emailFor('del3') });
      for (const who of ['gst', 'b']) {
        const res = await as(who).from('members').delete().eq('id', mid).select();
        expect(res.data ?? [], who).toEqual([]);
      }
      expect(rowsOf('members', { id: mid })).toHaveLength(1);
    });
  });

  it('the member row of an active person is visible to the whole workspace, an invitation too', async () => {
    const mid = await inviteAs('a', { email: emailFor('visible') });
    for (const who of ['adm', 'mem', 'mem2', 'gst']) {
      const rows = okOf(await as(who).from('members').select('id, status').eq('id', mid));
      expect(rows, who).toEqual([{ id: mid, status: 'invited' }]);
    }
    expect(okOf(await as('b').from('members').select('id').eq('id', mid))).toEqual([]);
    expect(memberId('a')).toBeTruthy();
  });
});
