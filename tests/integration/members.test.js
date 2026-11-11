import { describe, expect, it } from 'vitest';
import { as, available, denied, id, inviteAs, memberId, newUser, okOf, rowsOf, tag, user, world } from './helpers.js';

const row = who => rowsOf('members', { id: memberId(who) })[0];
const emailFor = label => `it-${world.run}-${label}-${tag()}@dash-it.test`;

/* A pending member nobody depends on: safe to promote, demote, rename and delete. */
const throwaway = async (role = 'member') => inviteAs('a', { email: emailFor('tmp'), name: 'Throwaway', role });

describe.skipIf(!available)('member guard (roles, ownership, own profile)', () => {
  describe('nobody gets a role they are not allowed to have', () => {
    it.each([
      ['mem', 'admin'],
      ['mem', 'guest'],
      ['mem', 'owner'],
      ['gst', 'member'],
      ['gst', 'admin'],
      ['adm', 'owner'],
    ])('%s cannot change their own role to %s', async (who, role) => {
      const before = row(who).role;
      denied(await as(who).from('members').update({ role }).eq('id', memberId(who)), '42501');
      expect(row(who).role).toBe(before);
    });

    it("a Member cannot change anybody else's role", async () => {
      const tmp = await throwaway();
      for (const target of [memberId('mem2'), memberId('adm'), memberId('gst'), tmp]) {
        const before = rowsOf('members', { id: target })[0].role;
        const res = await as('mem')
          .from('members')
          .update({ role: before === 'admin' ? 'guest' : 'admin' })
          .eq('id', target);
        denied(res, '42501');
        expect(rowsOf('members', { id: target })[0].role).toBe(before);
      }
    });

    it("a Guest cannot change anybody else's role", async () => {
      // a guest cannot even see the row as writable: the update matches nothing
      const res = await as('gst').from('members').update({ role: 'guest' }).eq('id', memberId('mem2')).select();
      expect(res.data ?? []).toEqual([]);
      expect(row('mem2').role).toBe('member');
    });

    it('nobody can become owner through the API: not by an admin, not by the owner', async () => {
      const tmp = await throwaway();
      denied(await as('adm').from('members').update({ role: 'owner' }).eq('id', memberId('mem')), '42501');
      denied(await as('a').from('members').update({ role: 'owner' }).eq('id', memberId('mem')), '42501');
      denied(await as('a').from('members').update({ role: 'owner' }).eq('id', tmp), '42501');
      expect(row('mem').role).toBe('member');
      expect(rowsOf('members', { id: tmp })[0].role).toBe('member');
      expect(rowsOf('members', { workspace_id: world.wsA, role: 'owner' })).toHaveLength(1);
    });

    it('the owner cannot be demoted, by an admin or by themselves', async () => {
      for (const [who, role] of [
        ['adm', 'admin'],
        ['adm', 'member'],
        ['adm', 'guest'],
        ['a', 'admin'],
        ['a', 'member'],
      ]) {
        denied(await as(who).from('members').update({ role }).eq('id', memberId('a')), '42501');
      }
      expect(row('a').role).toBe('owner');
    });

    it('the owner cannot be deactivated or have their e-mail changed', async () => {
      denied(await as('adm').from('members').update({ status: 'deactivated' }).eq('id', memberId('a')), '42501');
      denied(await as('adm').from('members').update({ email: 'hijack@x.io' }).eq('id', memberId('a')), '42501');
      expect(row('a')).toMatchObject({ status: 'active', email: user('a').email });
    });
  });

  describe('removing people', () => {
    it('the owner cannot be removed, not even by an admin or by themselves', async () => {
      denied(await as('adm').from('members').delete().eq('id', memberId('a')), '42501');
      denied(await as('a').from('members').delete().eq('id', memberId('a')), '42501');
      expect(row('a')).toBeTruthy();
    });

    it('a Member cannot remove another member', async () => {
      for (const target of ['mem2', 'adm', 'gst', 'a']) {
        const res = await as('mem').from('members').delete().eq('id', memberId(target)).select();
        expect(res.data ?? [], target).toEqual([]);
        expect(row(target), target).toBeTruthy();
      }
    });

    it('a Guest cannot remove anyone', async () => {
      const res = await as('gst').from('members').delete().eq('id', memberId('mem2')).select();
      expect(res.data ?? []).toEqual([]);
      expect(row('mem2')).toBeTruthy();
    });

    it('an Admin can remove a member (who then loses access to the workspace)', async () => {
      const p = await newUser('removed', 'Rex Removable');
      const mid = await inviteAs('a', { email: p.email, name: 'Rex', role: 'member' });
      expect(okOf(await p.client.rpc('claim_invitations'))).toBe(1);
      expect(okOf(await p.client.from('workspaces').select('id').eq('id', world.wsA))).toHaveLength(1);
      expect(okOf(await as('adm').from('members').delete().eq('id', mid).select())).toHaveLength(1);
      expect(rowsOf('members', { id: mid })).toHaveLength(0);
      expect(okOf(await p.client.from('workspaces').select('id').eq('id', world.wsA))).toEqual([]);
      expect(okOf(await p.client.from('projects').select('id').eq('workspace_id', world.wsA))).toEqual([]);
    });
  });

  describe('changes an Admin may make', () => {
    it('an Admin changes the role of a Member and back', async () => {
      try {
        expect(okOf(await as('adm').from('members').update({ role: 'guest' }).eq('id', memberId('mem2')).select())).toHaveLength(1);
        expect(row('mem2').role).toBe('guest');
        expect(okOf(await as('adm').from('members').update({ role: 'admin' }).eq('id', memberId('mem2')).select())).toHaveLength(1);
        expect(row('mem2').role).toBe('admin');
      } finally {
        okOf(await as('adm').from('members').update({ role: 'member' }).eq('id', memberId('mem2')));
      }
      expect(row('mem2').role).toBe('member');
    });

    it('the Owner changes the role of an Admin', async () => {
      const tmp = await throwaway('admin');
      okOf(await as('a').from('members').update({ role: 'member' }).eq('id', tmp));
      expect(rowsOf('members', { id: tmp })[0].role).toBe('member');
    });

    it('an Admin can deactivate and reactivate a member with an account, but cannot activate a pending invitation', async () => {
      try {
        okOf(await as('adm').from('members').update({ status: 'deactivated' }).eq('id', memberId('mem2')));
        expect(row('mem2').status).toBe('deactivated');
        // a deactivated member is out: they see nothing
        expect(okOf(await as('mem2').from('projects').select('id').eq('workspace_id', world.wsA))).toEqual([]);
      } finally {
        okOf(await as('adm').from('members').update({ status: 'active' }).eq('id', memberId('mem2')));
      }
      expect(row('mem2').status).toBe('active');
      const tmp = await throwaway();
      denied(await as('adm').from('members').update({ status: 'active' }).eq('id', tmp), '42501');
    });

    it('a Member cannot deactivate anyone or change their own status', async () => {
      denied(await as('mem').from('members').update({ status: 'deactivated' }).eq('id', memberId('mem2')), '42501');
      denied(await as('mem').from('members').update({ status: 'deactivated' }).eq('id', memberId('mem')), '42501');
      expect(row('mem2').status).toBe('active');
      expect(row('mem').status).toBe('active');
    });
  });

  describe('a person edits their own profile in the workspace', () => {
    it('a Member edits their own name, title and color', async () => {
      const old = row('mem');
      try {
        const res = await as('mem').from('members').update({ name: 'Mia Renamed', title: 'Designer', color: '#abcdef' }).eq('id', memberId('mem')).select();
        expect(okOf(res)).toHaveLength(1);
        expect(row('mem')).toMatchObject({ name: 'Mia Renamed', title: 'Designer', color: '#abcdef' });
      } finally {
        okOf(await as('mem').from('members').update({ name: old.name, title: old.title, color: old.color }).eq('id', memberId('mem')));
      }
      expect(row('mem').name).toBe(old.name);
    });

    it('a Guest edits their own name and title', async () => {
      const old = row('gst');
      try {
        okOf(await as('gst').from('members').update({ name: 'Gus Renamed', title: 'Reviewer' }).eq('id', memberId('gst')));
        expect(row('gst')).toMatchObject({ name: 'Gus Renamed', title: 'Reviewer' });
      } finally {
        okOf(await as('gst').from('members').update({ name: old.name, title: old.title }).eq('id', memberId('gst')));
      }
    });

    it('a member cannot change their own e-mail, account or workspace', async () => {
      const before = row('mem');
      denied(await as('mem').from('members').update({ email: 'someone-else@x.io' }).eq('id', memberId('mem')), '42501');
      denied(
        await as('mem')
          .from('members')
          .update({ user_id: user('b').id })
          .eq('id', memberId('mem')),
        '42501',
      );
      denied(await as('mem').from('members').update({ workspace_id: world.wsB }).eq('id', memberId('mem')), '42501');
      expect(row('mem')).toMatchObject({ email: before.email, user_id: before.user_id, workspace_id: before.workspace_id });
    });

    it('a Guest cannot move themselves to another team', async () => {
      const team = id();
      okOf(await as('a').from('teams').insert({ id: team, workspace_id: world.wsA, name: 'Guard team' }));
      denied(await as('gst').from('members').update({ team_id: team }).eq('id', memberId('gst')), '42501');
      expect(row('gst').team_id).toBeNull();
      okOf(await as('mem').from('members').update({ team_id: team }).eq('id', memberId('mem')));
      expect(row('mem').team_id).toBe(team);
      okOf(await as('mem').from('members').update({ team_id: null }).eq('id', memberId('mem')));
    });

    it('last_seen_at and invited_by cannot be forged by the client', async () => {
      const before = row('mem');
      okOf(
        await as('mem')
          .from('members')
          .update({ last_seen_at: '2000-01-01T00:00:00Z', invited_by: user('mem').id, title: 'Forger' })
          .eq('id', memberId('mem')),
      );
      const after = row('mem');
      expect(after.last_seen_at).toBe(before.last_seen_at);
      expect(after.invited_by).toBe(before.invited_by);
      okOf(await as('mem').from('members').update({ title: before.title }).eq('id', memberId('mem')));
    });

    it("a Member cannot rewrite another active member's name, title or color", async () => {
      const before = row('adm');
      const res = await as('mem').from('members').update({ name: 'Mallory', title: 'Impostor', color: '#000000' }).eq('id', memberId('adm')).select();
      const after = row('adm');
      expect({ name: after.name, title: after.title, color: after.color }, `update answered: ${JSON.stringify(res.error || res.data)}`).toEqual({
        name: before.name,
        title: before.title,
        color: before.color,
      });
    });

    it("a Guest cannot rewrite another member's profile", async () => {
      const before = row('mem');
      const res = await as('gst').from('members').update({ name: 'Mallory' }).eq('id', memberId('mem')).select();
      expect(res.data ?? []).toEqual([]);
      expect(row('mem').name).toBe(before.name);
    });
  });

  describe('personal rows stay personal', () => {
    it('a member can read the whole member list of their workspace, an outsider none of it', async () => {
      expect(okOf(await as('gst').from('members').select('id').eq('workspace_id', world.wsA)).length).toBeGreaterThanOrEqual(5);
      expect(okOf(await as('b').from('members').select('id').eq('workspace_id', world.wsA))).toEqual([]);
    });
  });
});
