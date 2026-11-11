import { describe, expect, it } from 'vitest';
import { as, available, denied, okOf, rowsOf, tag, user, world } from './helpers.js';

describe.skipIf(!available)('create_workspace and workspace_slug_available', () => {
  const name = () => `Slug Test ${world.run} ${tag()}`;

  it('creates the workspace, an active owner member and the personal member_state', async () => {
    const b = as('b');
    const wsName = name();
    const res = okOf(await b.rpc('create_workspace', { p_name: wsName, p_slug: null, p_color: '#123456' }), 'create_workspace');
    expect(res).toEqual({ workspace_id: expect.any(String), member_id: expect.any(String), slug: expect.stringMatching(/^slug-test-/) });

    const [ws] = await rowsOf('workspaces', { id: res.workspace_id });
    expect(ws).toMatchObject({ name: wsName, color: '#123456', created_by: user('b').id, slug: res.slug });

    const [member] = await rowsOf('members', { id: res.member_id });
    expect(member).toMatchObject({
      workspace_id: res.workspace_id,
      user_id: user('b').id,
      role: 'owner',
      status: 'active',
      email: user('b').email,
      name: user('b').name,
    });
    expect(member.last_seen_at).toBeTruthy();

    const state = await rowsOf('member_state', { member_id: res.member_id });
    expect(state).toHaveLength(1);
    expect(state[0].workspace_id).toBe(res.workspace_id);

    // and the creator can read all of it through the API
    const seen = okOf(await b.from('workspaces').select('id, name').eq('id', res.workspace_id));
    expect(seen).toHaveLength(1);
  });

  it('uses the default color when none is given and trims the name', async () => {
    const res = okOf(await as('b').rpc('create_workspace', { p_name: `  ${name()}  ` }), 'create_workspace');
    const [ws] = await rowsOf('workspaces', { id: res.workspace_id });
    expect(ws.color).toBe('#2F2E2A');
    expect(ws.name).toBe(ws.name.trim());
  });

  it('honours the slug that was asked for, normalising it', async () => {
    const wanted = `My Custom Slug ${world.run}-${tag()}`;
    const res = okOf(await as('b').rpc('create_workspace', { p_name: 'Whatever', p_slug: wanted, p_color: null }));
    expect(res.slug).toBe(wanted.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  });

  it('adds a numeric suffix when the slug is already taken', async () => {
    const wsName = name();
    const first = okOf(await as('b').rpc('create_workspace', { p_name: wsName, p_slug: null, p_color: null }));
    const second = okOf(await as('a').rpc('create_workspace', { p_name: wsName, p_slug: null, p_color: null }));
    const third = okOf(await as('mem').rpc('create_workspace', { p_name: wsName, p_slug: null, p_color: null }));
    expect(second.slug).toBe(`${first.slug}-2`);
    expect(third.slug).toBe(`${first.slug}-3`);
    expect(new Set([first.workspace_id, second.workspace_id, third.workspace_id]).size).toBe(3);
  });

  it('workspace_slug_available is false for a taken slug (in any spelling) and true for a free one', async () => {
    const c = as('b');
    const wsName = name();
    const created = okOf(await c.rpc('create_workspace', { p_name: wsName, p_slug: null, p_color: null }));
    expect(okOf(await c.rpc('workspace_slug_available', { p_slug: created.slug }))).toBe(false);
    expect(okOf(await c.rpc('workspace_slug_available', { p_slug: created.slug.toUpperCase() }))).toBe(false);
    expect(okOf(await c.rpc('workspace_slug_available', { p_slug: `free-${world.run}-${tag()}` }))).toBe(true);
    // somebody else's workspace counts too (the fixture one)
    const [wsA] = await rowsOf('workspaces', { id: world.wsA });
    expect(okOf(await as('mem2').rpc('workspace_slug_available', { p_slug: wsA.slug }))).toBe(false);
  });

  it('rejects an empty or blank name and does not create anything', async () => {
    const before = (await rowsOf('workspaces', { created_by: user('b').id })).length;
    for (const p_name of ['', '   ']) {
      const e = denied(await as('b').rpc('create_workspace', { p_name, p_slug: null, p_color: null }));
      expect(e.code).toBe('22023');
    }
    expect(await rowsOf('workspaces', { created_by: user('b').id })).toHaveLength(before);
  });

  it('the created workspace is invisible to everyone who is not a member', async () => {
    const res = okOf(await as('b').rpc('create_workspace', { p_name: name(), p_slug: null, p_color: null }));
    for (const who of ['a', 'adm', 'mem', 'gst']) {
      const seen = okOf(await as(who).from('workspaces').select('id').eq('id', res.workspace_id));
      expect(seen, who).toEqual([]);
    }
  });

  it('a member can read their workspace but not write to the table directly (no insert privilege)', async () => {
    denied(
      await as('a')
        .from('workspaces')
        .insert({ name: 'Direct', slug: `direct-${tag()}` }),
    );
    const rows = okOf(await as('mem').from('workspaces').select('id'));
    expect(rows.map(r => r.id)).toContain(world.wsA);
  });

  it('only admins can edit the workspace; members and guests change nothing', async () => {
    const newName = `Renamed ${tag()}`;
    for (const who of ['mem', 'gst']) {
      const res = await as(who).from('workspaces').update({ name: newName }).eq('id', world.wsA).select();
      expect(res.data ?? [], who).toEqual([]);
    }
    expect((await rowsOf('workspaces', { id: world.wsA }))[0].name).not.toBe(newName);
    const done = okOf(await as('adm').from('workspaces').update({ name: newName }).eq('id', world.wsA).select());
    expect(done).toHaveLength(1);
    okOf(
      await as('a')
        .from('workspaces')
        .update({ name: `Alpha ${world.run}` })
        .eq('id', world.wsA),
    );
    expect(rowsOf('workspaces', { id: world.wsA })[0].name).toBe(`Alpha ${world.run}`);
  });
});
