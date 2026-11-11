import { afterAll, describe, expect, it } from 'vitest';
import { ALL_TABLES, admin, anon, as, available, denied, id, okOf, query, world } from './helpers.js';

describe.skipIf(!available)('anonymous role', () => {
  const uploaded = [];
  afterAll(async () => {
    if (uploaded.length) await admin().storage.from('files').remove(uploaded);
  });

  it('there is data to protect (the fixture really has rows in every table)', () => {
    for (const t of ALL_TABLES) expect(query(`select count(*)::int as n from public.${t}`)[0].n, t).toBeGreaterThan(0);
  });

  it.each(ALL_TABLES)('cannot read %s', async table => {
    const res = await anon().from(table).select('*').limit(5);
    expect(res.error, 'anon must not be able to select').toBeTruthy();
    expect(res.error.code).toBe('42501');
    expect(res.data ?? []).toEqual([]);
  });

  it.each(ALL_TABLES)('cannot write to %s', async table => {
    const c = anon();
    const ins = await c.from(table).insert({ id: id() });
    denied(ins);
    expect(ins.data ?? null).toBeNull();
    denied(await c.from(table).update({ id: id() }).not('id', 'is', null));
    denied(await c.from(table).delete().not('id', 'is', null));
  });

  it('cannot run any of the exposed functions', async () => {
    const c = anon();
    denied(await c.rpc('claim_invitations'), '42501');
    denied(await c.rpc('create_workspace', { p_name: `Anon ${world.run}`, p_slug: null, p_color: null }), '42501');
    denied(await c.rpc('workspace_slug_available', { p_slug: 'anything' }), '42501');
    denied(await c.rpc('touch_presence', { ws: world.wsA }), '42501');
    expect(query(`select count(*)::int as n from public.workspaces where name = 'Anon ${world.run}'`)[0].n).toBe(0);
  });

  it('cannot reach the storage bucket (list, download, upload, signed or public URL)', async () => {
    const path = `${world.wsA}/${world.seed.project}/${id()}/anon-probe.txt`;
    okOf(
      await as('a')
        .storage.from('files')
        .upload(path, new Blob(['secret']), { contentType: 'text/plain' }),
      'owner upload',
    );
    uploaded.push(path);

    const c = anon();
    const listed = await c.storage.from('files').list(`${world.wsA}/${world.seed.project}`);
    expect(listed.error ? [] : listed.data).toEqual([]);
    denied(await c.storage.from('files').download(path));
    denied(await c.storage.from('files').createSignedUrl(path, 60));
    denied(await c.storage.from('files').upload(`${world.wsA}/${world.seed.project}/${id()}/anon.txt`, new Blob(['x'])));
    denied(
      await c.storage
        .from('files')
        .remove([path])
        .then(r => ({ error: r.error || (r.data?.length ? null : { message: 'nothing removed' }) })),
    );
    const pub = await fetch(`${world.url}/storage/v1/object/public/files/${path}`);
    expect(pub.ok).toBe(false);
    // the object is still there for the owner
    okOf(await as('a').storage.from('files').download(path), 'owner download');
  });

  it('a request with only the publishable key (no user token) is anonymous too', async () => {
    const res = await fetch(`${world.url}/rest/v1/tasks?select=id&limit=1`, { headers: { apikey: world.key } });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(false);
  });

  it('even authenticated users cannot call the private schema through the API', async () => {
    const c = as('a');
    const res = await c.schema('private').rpc('my_role', { ws: world.wsA });
    denied(res);
    const res2 = await c
      .schema('private')
      .rpc('notify', { ws: world.wsA, recipient: null, actor: null, kind: 'assign', tid: null, pid: null, txt: 'x', snip: '' });
    denied(res2);
  });
});
