import { describe, expect, it } from 'vitest';
import { as, available, id, newProject, okOf, query } from './helpers.js';

/* The database assigns each task's key from the project's counter (migration 20261111145659). */
describe.skipIf(!available)('task keys', () => {
  const keysOf = ids => query(`select id, key from public.tasks where id in (${ids.map(x => `'${x}'`).join(',')})`);

  it('tasks created at the same moment with the same key each get their own', async () => {
    const project = await newProject('a');
    const ids = Array.from({ length: 12 }, () => id());
    // twelve separate requests in flight together, all claiming the same key (what two browsers used to do)
    const results = await Promise.all(ids.map(tid => as('a').from('tasks').insert({ id: tid, project_id: project, key: 'DUP-201', title: 'same key' })));
    for (const r of results) okOf(r, 'insert');
    const keys = keysOf(ids).map(r => r.key);
    expect(new Set(keys).size).toBe(12);
    const [{ key: pkey }] = query(`select key from public.projects where id = '${project}'`);
    for (const k of keys) expect(k.startsWith(pkey + '-')).toBe(true);
  });

  it('the answer to the insert carries the key the database chose', async () => {
    const project = await newProject('a');
    const tid = id();
    const rows = okOf(
      await as('a')
        .from('tasks')
        .upsert({ id: tid, project_id: project, key: 'WRONG-1', title: 't' }, { onConflict: 'id', ignoreDuplicates: true })
        .select('id,key'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).not.toBe('WRONG-1');
    expect(rows[0].key).toBe(keysOf([tid])[0].key);
  });

  it('the key cannot be edited, and moving the task to another project gives it a key of that project', async () => {
    const p1 = await newProject('a');
    const p2 = await newProject('a');
    const tid = id();
    okOf(await as('a').from('tasks').insert({ id: tid, project_id: p1, key: 'X-1', title: 't' }));
    const before = keysOf([tid])[0].key;
    okOf(await as('a').from('tasks').update({ key: 'HACK-1', title: 'renamed' }).eq('id', tid));
    expect(keysOf([tid])[0].key).toBe(before);
    const moved = okOf(await as('a').from('tasks').update({ project_id: p2 }).eq('id', tid).select('id,key'));
    const [{ key: key2 }] = query(`select key from public.projects where id = '${p2}'`);
    expect(moved[0].key.startsWith(key2 + '-')).toBe(true);
    expect(moved[0].key).not.toBe(before);
  });

  it("a project's counter never goes back, whatever a client sends", async () => {
    const project = await newProject('a');
    okOf(await as('a').from('tasks').insert({ id: id(), project_id: project, key: 'X-1', title: 't' }));
    const [{ task_seq: before }] = query(`select task_seq from public.projects where id = '${project}'`);
    okOf(await as('a').from('projects').update({ task_seq: 1 }).eq('id', project));
    expect(query(`select task_seq from public.projects where id = '${project}'`)[0].task_seq).toBe(before);
  });

  it('a key is unique in the workspace even when two projects share the same prefix', async () => {
    const p1 = await newProject('a', { row: { key: 'SAME' } });
    const p2 = await newProject('a', { row: { key: 'SAME' } });
    const [a, b] = [id(), id()];
    okOf(await as('a').from('tasks').insert({ id: a, project_id: p1, key: 'SAME-201', title: 'one' }));
    okOf(await as('a').from('tasks').insert({ id: b, project_id: p2, key: 'SAME-201', title: 'two' }));
    const keys = keysOf([a, b]).map(r => r.key);
    expect(new Set(keys).size).toBe(2);
  });
});
