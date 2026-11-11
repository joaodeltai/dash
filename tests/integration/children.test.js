import { describe, expect, it } from 'vitest';
import { as, available, denied, id, memberId, newComment, newProject, newTask, okOf, rowsOf, user, world } from './helpers.js';

describe.skipIf(!available)('workspace_id of child rows is forced by the parent', () => {
  it("inserting rows with the workspace of another workspace stores the parent's workspace", async () => {
    const project = await newProject('a');
    const task = await newTask('a', project, { row: { workspace_id: world.wsB } });
    const a = as('a');
    const wrong = world.wsB;
    const ids = { sub: id(), cmt: id(), file: id(), ev: id(), view: id() };
    okOf(await a.from('subtasks').insert({ id: ids.sub, task_id: task, title: 's', workspace_id: wrong }));
    okOf(await a.from('comments').insert({ id: ids.cmt, task_id: task, author_id: memberId('a'), body: 'c', workspace_id: wrong }));
    okOf(await a.from('files').insert({ id: ids.file, project_id: project, name: 'f', workspace_id: wrong }));
    okOf(await a.from('events').insert({ id: ids.ev, project_id: project, title: 'e', event_date: '2026-01-01', workspace_id: wrong }));
    okOf(await a.from('saved_views').insert({ id: ids.view, project_id: project, name: 'v', workspace_id: wrong }));
    okOf(await a.from('project_members').insert({ project_id: project, member_id: memberId('mem'), workspace_id: wrong }));
    okOf(await a.from('project_favorites').insert({ member_id: memberId('a'), project_id: project, workspace_id: wrong }));
    okOf(await a.from('task_favorites').insert({ member_id: memberId('a'), task_id: task, workspace_id: wrong }));
    const other = await newTask('a', project);
    okOf(await a.from('task_dependencies').insert({ task_id: task, depends_on_id: other, workspace_id: wrong }));

    expect(rowsOf('tasks', { id: task })[0].workspace_id).toBe(world.wsA);
    expect(rowsOf('subtasks', { id: ids.sub })[0].workspace_id).toBe(world.wsA);
    expect(rowsOf('comments', { id: ids.cmt })[0].workspace_id).toBe(world.wsA);
    expect(rowsOf('files', { id: ids.file })[0].workspace_id).toBe(world.wsA);
    expect(rowsOf('events', { id: ids.ev })[0].workspace_id).toBe(world.wsA);
    expect(rowsOf('saved_views', { id: ids.view })[0].workspace_id).toBe(world.wsA);
    expect(rowsOf('project_members', { project_id: project, member_id: memberId('mem') })[0].workspace_id).toBe(world.wsA);
    expect(rowsOf('project_favorites', { project_id: project })[0].workspace_id).toBe(world.wsA);
    expect(rowsOf('task_favorites', { task_id: task })[0].workspace_id).toBe(world.wsA);
    expect(rowsOf('task_dependencies', { task_id: task })[0].workspace_id).toBe(world.wsA);
  });

  it('updating workspace_id on a child row does not move it', async () => {
    const project = await newProject('a');
    const task = await newTask('a', project);
    const sub = id();
    okOf(await as('a').from('subtasks').insert({ id: sub, task_id: task, title: 's' }));
    await as('a').from('tasks').update({ workspace_id: world.wsB, title: 'moved?' }).eq('id', task);
    await as('a').from('subtasks').update({ workspace_id: world.wsB }).eq('id', sub);
    expect(rowsOf('tasks', { id: task })[0]).toMatchObject({ workspace_id: world.wsA, title: 'moved?' });
    expect(rowsOf('subtasks', { id: sub })[0].workspace_id).toBe(world.wsA);
  });

  it('a user outside the workspace cannot write a child row, whatever workspace_id they claim', async () => {
    const project = await newProject('a');
    const task = await newTask('a', project);
    const b = as('b');
    for (const ws of [world.wsA, world.wsB]) {
      denied(await b.from('tasks').insert({ project_id: project, workspace_id: ws, key: 'X-1', title: 'planted' }));
      denied(await b.from('subtasks').insert({ task_id: task, workspace_id: ws, title: 'planted' }));
      denied(await b.from('comments').insert({ task_id: task, workspace_id: ws, author_id: memberId('b'), body: 'planted' }));
    }
    denied(await b.from('activity').insert({ workspace_id: world.wsA, actor_id: memberId('b'), verb: 'planted' }));
    denied(await b.from('events').insert({ workspace_id: world.wsA, title: 'planted', event_date: '2026-01-01' }));
    expect(rowsOf('tasks', { project_id: project })).toHaveLength(1);
  });

  it('a child row cannot be created under a parent that does not exist', async () => {
    denied(await as('a').from('tasks').insert({ project_id: id(), key: 'X-1', title: 'orphan' }));
    denied(await as('a').from('subtasks').insert({ task_id: id(), title: 'orphan' }));
  });

  it('references to people of another workspace are refused (assignee, subtask assignee, project member)', async () => {
    const project = await newProject('a');
    denied(
      await as('a')
        .from('tasks')
        .insert({ project_id: project, key: 'X-1', title: 't', assignee_id: memberId('b') }),
      '23514',
    );
    const task = await newTask('a', project);
    denied(
      await as('a')
        .from('tasks')
        .update({ assignee_id: memberId('b') })
        .eq('id', task),
      '23514',
    );
    denied(
      await as('a')
        .from('subtasks')
        .insert({ task_id: task, title: 's', assignee_id: memberId('b') }),
      '23514',
    );
    denied(
      await as('a')
        .from('project_members')
        .insert({ project_id: project, member_id: memberId('b') }),
      '23514',
    );
    expect(rowsOf('tasks', { id: task })[0].assignee_id).toBeNull();
  });

  it('a dependency cannot point at a task of another workspace', async () => {
    const project = await newProject('a');
    const task = await newTask('a', project);
    const projectB = id();
    okOf(
      await as('b')
        .from('projects')
        .insert({ id: projectB, workspace_id: world.wsB, key: 'BB', name: 'B project', created_by: user('b').id }),
    );
    const taskB = await newTaskInB(projectB);
    denied(await as('a').from('task_dependencies').insert({ task_id: task, depends_on_id: taskB }));
    expect(rowsOf('task_dependencies', { task_id: task })).toHaveLength(0);
  });
});

async function newTaskInB(project) {
  const tid = id();
  okOf(await as('b').from('tasks').insert({ id: tid, project_id: project, key: 'B-1', title: 'b task' }));
  return tid;
}

describe.skipIf(!available)('comments', () => {
  const setup = async () => {
    const project = await newProject('a');
    const task = await newTask('a', project);
    return { project, task };
  };
  const body = c => rowsOf('comments', { id: c })[0].body;

  it('the author_id has to be the signed-in member on insert', async () => {
    const { task } = await setup();
    for (const who of ['a', 'adm', 'mem', 'mem2'])
      okOf(
        await as(who)
          .from('comments')
          .insert({ id: id(), task_id: task, author_id: memberId(who), body: 'mine' }),
      );
    denied(
      await as('mem')
        .from('comments')
        .insert({ id: id(), task_id: task, author_id: memberId('a'), body: 'as someone else' }),
    );
    denied(await as('mem').from('comments').insert({ id: id(), task_id: task, author_id: null, body: 'anonymous' }));
    denied(
      await as('a')
        .from('comments')
        .insert({ id: id(), task_id: task, author_id: memberId('mem'), body: 'impersonation' }),
    );
    expect(rowsOf('comments', { task_id: task })).toHaveLength(4);
  });

  it('only the author edits the text (and edited_at); everyone else is refused', async () => {
    const { task } = await setup();
    const c = await newComment('mem', task, 'original');
    for (const who of ['a', 'adm', 'mem2']) {
      denied(
        await as(who)
          .from('comments')
          .update({ body: 'edited by ' + who })
          .eq('id', c),
        '42501',
      );
      denied(await as(who).from('comments').update({ edited_at: new Date().toISOString() }).eq('id', c), '42501');
    }
    expect(body(c)).toBe('original');
    okOf(await as('mem').from('comments').update({ body: 'edited', edited_at: new Date().toISOString() }).eq('id', c));
    expect(body(c)).toBe('edited');
    expect(rowsOf('comments', { id: c })[0].edited_at).toBeTruthy();
  });

  it('another member can change only the reactions', async () => {
    const { task } = await setup();
    const c = await newComment('mem', task, 'original');
    const re = { '👍': [memberId('mem2')] };
    expect(okOf(await as('mem2').from('comments').update({ reactions: re }).eq('id', c).select())).toHaveLength(1);
    expect(rowsOf('comments', { id: c })[0]).toMatchObject({ reactions: re, body: 'original' });
    // a mixed update (reactions + body) is refused as a whole
    denied(await as('mem2').from('comments').update({ reactions: {}, body: 'sneaky' }).eq('id', c), '42501');
    expect(rowsOf('comments', { id: c })[0]).toMatchObject({ reactions: re, body: 'original' });
  });

  it('nobody can change the task, the author or the date of a comment', async () => {
    const { project, task } = await setup();
    const other = await newTask('a', project);
    const c = await newComment('mem', task, 'x');
    denied(
      await as('mem')
        .from('comments')
        .update({ author_id: memberId('a') })
        .eq('id', c),
      '42501',
    );
    denied(await as('mem').from('comments').update({ task_id: other }).eq('id', c), '42501');
    denied(await as('mem').from('comments').update({ created_at: '2000-01-01T00:00:00Z' }).eq('id', c), '42501');
    denied(
      await as('a')
        .from('comments')
        .update({ author_id: memberId('a') })
        .eq('id', c),
      '42501',
    );
    expect(rowsOf('comments', { id: c })[0]).toMatchObject({ author_id: memberId('mem'), task_id: task });
  });

  it('reactions have to be a JSON object', async () => {
    const { task } = await setup();
    const c = await newComment('mem', task, 'x');
    denied(
      await as('mem')
        .from('comments')
        .update({ reactions: [1, 2] })
        .eq('id', c),
      '23514',
    );
  });

  it('the author and an Admin can delete a comment; another member cannot', async () => {
    const { task } = await setup();
    const c1 = await newComment('mem', task, 'a');
    const c2 = await newComment('mem', task, 'b');
    const c3 = await newComment('mem', task, 'c');
    expect((await as('mem2').from('comments').delete().eq('id', c1).select()).data ?? []).toEqual([]);
    expect((await as('gst').from('comments').delete().eq('id', c1).select()).data ?? []).toEqual([]);
    expect(rowsOf('comments', { id: c1 })).toHaveLength(1);
    expect(okOf(await as('mem').from('comments').delete().eq('id', c1).select())).toHaveLength(1);
    expect(okOf(await as('adm').from('comments').delete().eq('id', c2).select())).toHaveLength(1);
    expect(okOf(await as('a').from('comments').delete().eq('id', c3).select())).toHaveLength(1);
  });

  it('comments of a task are visible to everyone who can see the task, and to nobody else', async () => {
    const { task } = await setup();
    const c = await newComment('mem', task, 'hello');
    for (const who of ['a', 'adm', 'mem2']) expect(okOf(await as(who).from('comments').select('id').eq('id', c)), who).toHaveLength(1);
    expect(okOf(await as('gst').from('comments').select('id').eq('id', c))).toEqual([]);
    expect(okOf(await as('b').from('comments').select('id').eq('id', c))).toEqual([]);
  });
});

describe.skipIf(!available)('activity log', () => {
  const entry = (who, over = {}) => ({ id: id(), workspace_id: world.wsA, actor_id: memberId(who), verb: 'did something', ...over });

  it('actor_id must be the signed-in member', async () => {
    for (const who of ['a', 'adm', 'mem', 'mem2', 'gst']) okOf(await as(who).from('activity').insert(entry(who)));
    denied(await as('mem').from('activity').insert(entry('a')));
    denied(
      await as('mem')
        .from('activity')
        .insert(entry('mem', { actor_id: null })),
    );
    denied(await as('a').from('activity').insert(entry('mem')));
  });

  it('is append-only: nobody can update or delete an entry, the owner included', async () => {
    const e = entry('mem');
    okOf(await as('mem').from('activity').insert(e));
    for (const who of ['mem', 'a', 'adm']) {
      denied(await as(who).from('activity').update({ verb: 'rewritten' }).eq('id', e.id));
      denied(await as(who).from('activity').delete().eq('id', e.id));
    }
    expect(rowsOf('activity', { id: e.id })[0].verb).toBe('did something');
  });

  it('is readable by the members of the workspace (workspace-level entries), not by outsiders', async () => {
    const e = entry('mem');
    okOf(await as('mem').from('activity').insert(e));
    for (const who of ['a', 'adm', 'mem2', 'gst']) expect(okOf(await as(who).from('activity').select('id').eq('id', e.id)), who).toHaveLength(1);
    expect(okOf(await as('b').from('activity').select('id').eq('id', e.id))).toEqual([]);
  });

  it('an entry for a project needs comment access to that project', async () => {
    const open = await newProject('a');
    const hidden = await newProject('a', { row: { is_private: true } });
    const viewOnly = await newProject('a');
    okOf(
      await as('a')
        .from('project_members')
        .insert({ project_id: viewOnly, member_id: memberId('mem2'), permission: 'Can view' }),
    );
    okOf(
      await as('mem2')
        .from('activity')
        .insert(entry('mem2', { project_id: open })),
    );
    // read-only people do not act on the project, so they leave no activity either (the policy asks for comment level)
    denied(
      await as('mem2')
        .from('activity')
        .insert(entry('mem2', { project_id: viewOnly })),
    );
    const commentOnly = await newProject('a');
    await as('a')
      .from('project_members')
      .insert({ project_id: commentOnly, member_id: memberId('mem2'), permission: 'Can comment' });
    okOf(
      await as('mem2')
        .from('activity')
        .insert(entry('mem2', { project_id: commentOnly })),
    );
    denied(
      await as('mem2')
        .from('activity')
        .insert(entry('mem2', { project_id: hidden })),
    );
    denied(
      await as('gst')
        .from('activity')
        .insert(entry('gst', { project_id: open })),
    );
  });

  it('cannot be written into another workspace', async () => {
    denied(
      await as('a')
        .from('activity')
        .insert({ id: id(), workspace_id: world.wsB, actor_id: memberId('a'), verb: 'x' }),
    );
    denied(
      await as('b')
        .from('activity')
        .insert({ id: id(), workspace_id: world.wsA, actor_id: memberId('a'), verb: 'x' }),
    );
  });

  it('a verb is required and limited to 80 characters', async () => {
    denied(
      await as('a')
        .from('activity')
        .insert(entry('a', { verb: '' })),
      '23514',
    );
    denied(
      await as('a')
        .from('activity')
        .insert(entry('a', { verb: 'v'.repeat(81) })),
      '23514',
    );
  });
});

describe.skipIf(!available)('personal data stays personal (favorites, member_state, profile)', () => {
  it('favorites are only visible to their owner', async () => {
    const project = await newProject('a');
    const task = await newTask('a', project);
    okOf(
      await as('mem')
        .from('task_favorites')
        .insert({ member_id: memberId('mem'), task_id: task }),
    );
    okOf(
      await as('mem')
        .from('project_favorites')
        .insert({ member_id: memberId('mem'), project_id: project }),
    );
    expect(okOf(await as('mem').from('task_favorites').select('task_id').eq('task_id', task))).toHaveLength(1);
    expect(okOf(await as('mem').from('project_favorites').select('project_id').eq('project_id', project))).toHaveLength(1);
    for (const who of ['a', 'adm', 'mem2', 'gst', 'b']) {
      expect(okOf(await as(who).from('task_favorites').select('task_id').eq('task_id', task)), who).toEqual([]);
      expect(okOf(await as(who).from('project_favorites').select('project_id').eq('project_id', project)), who).toEqual([]);
    }
  });

  it("nobody can create or remove somebody else's favorite", async () => {
    const project = await newProject('a');
    const task = await newTask('a', project);
    okOf(
      await as('mem')
        .from('task_favorites')
        .insert({ member_id: memberId('mem'), task_id: task }),
    );
    denied(
      await as('a')
        .from('task_favorites')
        .insert({ member_id: memberId('mem2'), task_id: task }),
    );
    denied(
      await as('a')
        .from('project_favorites')
        .insert({ member_id: memberId('mem2'), project_id: project }),
    );
    expect((await as('a').from('task_favorites').delete().eq('task_id', task).select()).data ?? []).toEqual([]);
    expect((await as('adm').from('task_favorites').delete().eq('member_id', memberId('mem')).select()).data ?? []).toEqual([]);
    expect(rowsOf('task_favorites', { task_id: task })).toHaveLength(1);
  });

  it('a favorite on something you cannot see is refused', async () => {
    const hidden = await newProject('a', { row: { is_private: true } });
    const task = await newTask('a', hidden);
    denied(
      await as('mem2')
        .from('task_favorites')
        .insert({ member_id: memberId('mem2'), task_id: task }),
    );
    denied(
      await as('mem2')
        .from('project_favorites')
        .insert({ member_id: memberId('mem2'), project_id: hidden }),
    );
  });

  it('member_state: each member reads and writes only their own row', async () => {
    // members who joined by invitation have no row until they first open the workspace; the app creates it with this upsert
    okOf(
      await as('mem')
        .from('member_state')
        .upsert({ member_id: memberId('mem'), workspace_id: world.wsA, state: {} }, { onConflict: 'member_id', ignoreDuplicates: true }),
    );
    const mine = okOf(await as('mem').from('member_state').select('member_id, state'));
    expect(mine.map(r => r.member_id)).toEqual([memberId('mem')]);
    expect(okOf(await as('mem').from('member_state').select('member_id').eq('member_id', memberId('a')))).toEqual([]);
    const before = rowsOf('member_state', { member_id: memberId('a') })[0].state;
    expect(
      (
        await as('mem')
          .from('member_state')
          .update({ state: { hacked: true } })
          .eq('member_id', memberId('a'))
          .select()
      ).data ?? [],
    ).toEqual([]);
    expect(rowsOf('member_state', { member_id: memberId('a') })[0].state).toEqual(before);
    denied(
      await as('mem')
        .from('member_state')
        .insert({ member_id: memberId('mem2'), workspace_id: world.wsA, state: {} }),
    );
    okOf(
      await as('mem')
        .from('member_state')
        .update({ state: { projOrder: ['x'] } })
        .eq('member_id', memberId('mem')),
    );
    expect(rowsOf('member_state', { member_id: memberId('mem') })[0].state).toEqual({ projOrder: ['x'] });
    // nobody else can read it back
    expect(okOf(await as('a').from('member_state').select('member_id').eq('member_id', memberId('mem')))).toEqual([]);
  });

  it('profiles: only your own, and only the preference columns can be edited', async () => {
    expect(okOf(await as('mem').from('profiles').select('id')).map(r => r.id)).toEqual([user('mem').id]);
    expect(okOf(await as('mem').from('profiles').select('id').eq('id', user('a').id))).toEqual([]);
    expect((await as('mem').from('profiles').update({ full_name: 'hacked' }).eq('id', user('a').id).select()).data ?? []).toEqual([]);
    const before = rowsOf('profiles', { id: user('mem').id })[0];
    okOf(
      await as('mem')
        .from('profiles')
        .update({ prefs: { theme: 'dark' } })
        .eq('id', user('mem').id),
    );
    expect(rowsOf('profiles', { id: user('mem').id })[0].prefs).toEqual({ theme: 'dark' });
    okOf(await as('mem').from('profiles').update({ prefs: before.prefs }).eq('id', user('mem').id));
    // the e-mail of the profile is what create_workspace copies into the owner member: it must not be editable
    denied(await as('mem').from('profiles').update({ email: 'someone-else@x.io' }).eq('id', user('mem').id));
    expect(rowsOf('profiles', { id: user('mem').id })[0].email).toBe(before.email);
  });
});
