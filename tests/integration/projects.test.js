import { describe, expect, it } from 'vitest';
import { addProjectMember, as, available, denied, id, memberId, newComment, newProject, newTask, okOf, rowsOf, user, world } from './helpers.js';

/* A project with one row in every project-scoped table, created by the owner. */
async function fullProject({ priv = false, members = {} } = {}) {
  const project = await newProject('a', { row: { is_private: priv } });
  for (const [who, permission] of Object.entries(members)) await addProjectMember('a', project, who, permission);
  const task = await newTask('a', project);
  const ids = { project, task, subtask: id(), comment: await newComment('a', task, 'a comment'), file: id(), activity: id(), view: id(), event: id() };
  const a = as('a');
  okOf(await a.from('subtasks').insert({ id: ids.subtask, task_id: task, title: 'sub' }));
  okOf(await a.from('files').insert({ id: ids.file, project_id: project, name: 'f.txt' }));
  okOf(
    await a
      .from('activity')
      .insert({ id: ids.activity, workspace_id: world.wsA, actor_id: memberId('a'), verb: 'created', task_id: task, project_id: project }),
  );
  okOf(await a.from('saved_views').insert({ id: ids.view, project_id: project, name: 'v' }));
  okOf(await a.from('events').insert({ id: ids.event, workspace_id: world.wsA, project_id: project, title: 'e', event_date: '2026-01-01' }));
  return ids;
}
const SCOPED = {
  projects: 'project',
  tasks: 'task',
  subtasks: 'subtask',
  comments: 'comment',
  files: 'file',
  activity: 'activity',
  saved_views: 'view',
  events: 'event',
};
const visibleIds = async (who, ids) => {
  const out = {};
  for (const [table, key] of Object.entries(SCOPED)) out[table] = okOf(await as(who).from(table).select('id').eq('id', ids[key])).length === 1;
  return out;
};
const allTrue = obj => Object.fromEntries(Object.keys(obj).map(k => [k, true]));
const allFalse = obj => Object.fromEntries(Object.keys(obj).map(k => [k, false]));

describe.skipIf(!available)('projects: who can create them', () => {
  it('Owner, Admin and Member create projects; the database records who created them', async () => {
    for (const who of ['a', 'adm', 'mem']) {
      const pid = await newProject(who);
      expect(rowsOf('projects', { id: pid })[0]).toMatchObject({ created_by: user(who).id, workspace_id: world.wsA });
    }
  });

  it('a Guest cannot create a project', async () => {
    const pid = id();
    denied(
      await as('gst')
        .from('projects')
        .insert({ id: pid, workspace_id: world.wsA, key: 'GUEST', name: 'nope', created_by: user('gst').id }),
    );
    expect(rowsOf('projects', { id: pid })).toHaveLength(0);
  });

  it('an outsider cannot create a project in workspace A', async () => {
    const pid = id();
    denied(
      await as('b')
        .from('projects')
        .insert({ id: pid, workspace_id: world.wsA, key: 'OUT', name: 'nope', created_by: user('b').id }),
    );
    expect(rowsOf('projects', { id: pid })).toHaveLength(0);
  });

  it('created_by cannot be forged on creation, nor changed afterwards', async () => {
    const pid = id();
    okOf(
      await as('mem')
        .from('projects')
        .insert({ id: pid, workspace_id: world.wsA, key: 'FORGE', name: 'forge', created_by: user('a').id }),
    );
    expect(rowsOf('projects', { id: pid })[0].created_by).toBe(user('mem').id);
    await as('mem')
      .from('projects')
      .update({ created_by: user('a').id, name: 'forge 2' })
      .eq('id', pid);
    expect(rowsOf('projects', { id: pid })[0].created_by).toBe(user('mem').id);
  });

  it('a project cannot point at a lead or a team of another workspace', async () => {
    const pid = id();
    denied(
      await as('a')
        .from('projects')
        .insert({ id: pid, workspace_id: world.wsA, key: 'XWS', name: 'x', lead_id: memberId('b') }),
      '23514',
    );
    const p = await newProject('a');
    denied(
      await as('a')
        .from('projects')
        .update({ lead_id: memberId('b') })
        .eq('id', p),
      '23514',
    );
  });
});

describe.skipIf(!available)('projects: a Guest only sees the projects they were added to', () => {
  it('sees the project, tasks, subtasks, comments, files, activity, views and events of their project and of nothing else', async () => {
    const mine = await fullProject({ members: { gst: 'Can comment' } });
    const other = await fullProject();
    const privateOther = await fullProject({ priv: true });
    expect(await visibleIds('gst', mine)).toEqual(allTrue(SCOPED));
    expect(await visibleIds('gst', other)).toEqual(allFalse(SCOPED));
    expect(await visibleIds('gst', privateOther)).toEqual(allFalse(SCOPED));
  });

  it("listing the tables returns rows of the guest's projects only", async () => {
    const mine = await fullProject({ members: { gst: null } });
    const other = await fullProject();
    const c = as('gst');
    const projects = okOf(await c.from('projects').select('id').eq('workspace_id', world.wsA)).map(r => r.id);
    expect(projects).toContain(mine.project);
    expect(projects).not.toContain(other.project);
    const tasks = okOf(await c.from('tasks').select('id, project_id').eq('workspace_id', world.wsA));
    expect(tasks.some(t => t.project_id === mine.project)).toBe(true);
    expect(tasks.some(t => t.project_id === other.project)).toBe(false);
    for (const table of ['activity', 'files', 'saved_views', 'events']) {
      const rows = okOf(await c.from(table).select('id, project_id').eq('workspace_id', world.wsA));
      expect(
        rows.some(r => r.project_id === other.project),
        table,
      ).toBe(false);
    }
    expect(okOf(await c.from('comments').select('id').eq('task_id', other.task))).toEqual([]);
    expect(okOf(await c.from('subtasks').select('id').eq('task_id', other.task))).toEqual([]);
  });

  it('cannot write into a project they are not part of', async () => {
    const other = await fullProject();
    const c = as('gst');
    denied(await c.from('tasks').insert({ project_id: other.project, key: 'G-1', title: 'nope' }));
    denied(await c.from('comments').insert({ task_id: other.task, author_id: memberId('gst'), body: 'nope' }));
    denied(await c.from('activity').insert({ workspace_id: world.wsA, actor_id: memberId('gst'), verb: 'x', project_id: other.project }));
    expect((await c.from('tasks').update({ title: 'hacked' }).eq('id', other.task).select()).data ?? []).toEqual([]);
    expect(rowsOf('tasks', { id: other.task })[0].title).not.toBe('hacked');
  });

  it('removing a guest from the project hides it again', async () => {
    const mine = await fullProject({ members: { gst: 'Can view' } });
    expect(await visibleIds('gst', mine)).toEqual(allTrue(SCOPED));
    okOf(await as('a').from('project_members').delete().eq('project_id', mine.project).eq('member_id', memberId('gst')));
    expect(await visibleIds('gst', mine)).toEqual(allFalse(SCOPED));
  });

  it('a Member (not guest) sees every non-private project of the workspace', async () => {
    const open = await fullProject();
    expect(await visibleIds('mem2', open)).toEqual(allTrue(SCOPED));
    expect(await visibleIds('adm', open)).toEqual(allTrue(SCOPED));
  });
});

describe.skipIf(!available)('projects: private projects', () => {
  it('are invisible to everyone who is not a member of the project, Admin included', async () => {
    const p = await fullProject({ priv: true, members: { mem2: 'Can edit' } });
    expect(await visibleIds('mem2', p)).toEqual(allTrue(SCOPED));
    expect(await visibleIds('a', p)).toEqual(allTrue(SCOPED)); // creator
    expect(await visibleIds('adm', p)).toEqual(allFalse(SCOPED));
    expect(await visibleIds('mem', p)).toEqual(allFalse(SCOPED));
    expect(await visibleIds('gst', p)).toEqual(allFalse(SCOPED));
    expect(await visibleIds('b', p)).toEqual(allFalse(SCOPED));
  });

  it('a private project made by a Member is hidden from an Admin who was not added', async () => {
    const pid = await newProject('mem', { row: { is_private: true } });
    const task = await newTask('mem', pid);
    expect(okOf(await as('mem').from('projects').select('id').eq('id', pid))).toHaveLength(1);
    expect(okOf(await as('adm').from('projects').select('id').eq('id', pid))).toEqual([]);
    expect(okOf(await as('adm').from('tasks').select('id').eq('id', task))).toEqual([]);
    expect(okOf(await as('mem2').from('projects').select('id').eq('id', pid))).toEqual([]);
  });

  it('a person who cannot see a private project cannot change, delete or fill it either', async () => {
    const pid = await newProject('mem', { row: { is_private: true } });
    const task = await newTask('mem', pid);
    for (const who of ['adm', 'mem2', 'gst']) {
      expect((await as(who).from('projects').update({ name: 'hacked' }).eq('id', pid).select()).data ?? [], who).toEqual([]);
      expect((await as(who).from('projects').delete().eq('id', pid).select()).data ?? [], who).toEqual([]);
      expect((await as(who).from('tasks').update({ title: 'hacked' }).eq('id', task).select()).data ?? [], who).toEqual([]);
      denied(await as(who).from('tasks').insert({ project_id: pid, key: 'X-1', title: 'planted' }));
    }
    expect(rowsOf('projects', { id: pid })[0].name).not.toBe('hacked');
  });

  it('adding a person to the project makes it visible to them (and only to them)', async () => {
    const pid = await newProject('mem', { row: { is_private: true } });
    await addProjectMember('mem', pid, 'adm', null);
    expect(okOf(await as('adm').from('projects').select('id').eq('id', pid))).toHaveLength(1);
    expect(okOf(await as('mem2').from('projects').select('id').eq('id', pid))).toEqual([]);
  });

  it('turning a public project private hides it from people who are not on it', async () => {
    const p = await fullProject();
    expect(await visibleIds('mem2', p)).toEqual(allTrue(SCOPED));
    okOf(await as('a').from('projects').update({ is_private: true }).eq('id', p.project));
    expect(await visibleIds('mem2', p)).toEqual(allFalse(SCOPED));
  });
});

describe.skipIf(!available)('projects: permission levels', () => {
  const levels = [
    // permission, canEdit, canComment, canManage
    ['Can view', false, false, false],
    ['Can comment', false, true, false],
    ['Can edit', true, true, false],
    ['Full access', true, true, true],
  ];
  const people = ['mem2', 'gst'];

  describe.each(levels)('%s', (permission, canEdit, canComment, canManage) => {
    describe.each(people)('as %s', who => {
      const setup = async () => {
        const project = await newProject('a');
        await addProjectMember('a', project, who, permission);
        const task = await newTask('a', project);
        return { project, task };
      };

      it('can always read', async () => {
        const { project, task } = await setup();
        expect(okOf(await as(who).from('projects').select('id').eq('id', project))).toHaveLength(1);
        expect(okOf(await as(who).from('tasks').select('id').eq('id', task))).toHaveLength(1);
      });

      it(canEdit ? 'can edit and create tasks' : 'cannot edit or create tasks', async () => {
        const { project, task } = await setup();
        const upd = await as(who)
          .from('tasks')
          .update({ title: 'edited by ' + who })
          .eq('id', task)
          .select();
        const ins = await as(who).from('tasks').insert({ id: id(), project_id: project, key: 'N-1', title: 'new' });
        if (canEdit) {
          expect(okOf(upd)).toHaveLength(1);
          okOf(ins);
          expect(rowsOf('tasks', { id: task })[0].title).toBe('edited by ' + who);
        } else {
          expect(upd.data ?? []).toEqual([]);
          denied(ins);
          expect(rowsOf('tasks', { id: task })[0].title).not.toBe('edited by ' + who);
        }
      });

      it(canEdit ? 'can add, change and remove subtasks' : 'cannot touch subtasks', async () => {
        const { task } = await setup();
        const sid = id();
        const ins = await as(who).from('subtasks').insert({ id: sid, task_id: task, title: 's' });
        if (canEdit) {
          okOf(ins);
          expect(okOf(await as(who).from('subtasks').update({ done: true }).eq('id', sid).select())).toHaveLength(1);
          expect(okOf(await as(who).from('subtasks').delete().eq('id', sid).select())).toHaveLength(1);
        } else {
          denied(ins);
          okOf(await as('a').from('subtasks').insert({ id: sid, task_id: task, title: 's' }));
          expect((await as(who).from('subtasks').update({ done: true }).eq('id', sid).select()).data ?? []).toEqual([]);
          expect((await as(who).from('subtasks').delete().eq('id', sid).select()).data ?? []).toEqual([]);
          expect(rowsOf('subtasks', { id: sid })[0].done).toBe(false);
        }
      });

      it(canComment ? 'can comment as themselves' : 'cannot comment', async () => {
        const { task } = await setup();
        const ins = await as(who)
          .from('comments')
          .insert({ id: id(), task_id: task, author_id: memberId(who), body: 'hi from ' + who });
        if (canComment) okOf(ins);
        else denied(ins);
        expect(rowsOf('comments', { task_id: task })).toHaveLength(canComment ? 1 : 0);
      });

      it(canEdit ? 'can attach files' : 'cannot attach files', async () => {
        const { project } = await setup();
        const ins = await as(who).from('files').insert({ id: id(), project_id: project, name: 'x.txt' });
        if (canEdit) okOf(ins);
        else denied(ins);
      });

      it(canEdit ? 'can edit the project' : 'cannot edit the project', async () => {
        const { project } = await setup();
        const res = await as(who)
          .from('projects')
          .update({ name: 'renamed by ' + who })
          .eq('id', project)
          .select();
        expect(rowsOf('projects', { id: project })[0].name === 'renamed by ' + who).toBe(canEdit);
        expect((res.data ?? []).length).toBe(canEdit ? 1 : 0);
      });

      it(canManage ? 'can delete the project' : 'cannot delete the project', async () => {
        const { project } = await setup();
        const res = await as(who).from('projects').delete().eq('id', project).select();
        expect((res.data ?? []).length).toBe(canManage ? 1 : 0);
        expect(rowsOf('projects', { id: project })).toHaveLength(canManage ? 0 : 1);
      });

      it(canManage ? 'can grant explicit permissions to others' : 'cannot grant explicit permissions to others', async () => {
        const { project } = await setup();
        const other = who === 'gst' ? 'mem' : 'gst';
        const res = await as(who)
          .from('project_members')
          .insert({ project_id: project, member_id: memberId(other), permission: 'Full access' });
        if (canManage) okOf(res);
        else denied(res);
      });
    });
  });

  it('a Guest without an explicit permission can comment but not edit', async () => {
    const project = await newProject('a');
    await addProjectMember('a', project, 'gst', null);
    const task = await newTask('a', project);
    okOf(
      await as('gst')
        .from('comments')
        .insert({ id: id(), task_id: task, author_id: memberId('gst'), body: 'ok' }),
    );
    expect((await as('gst').from('tasks').update({ title: 'hacked' }).eq('id', task).select()).data ?? []).toEqual([]);
    denied(await as('gst').from('tasks').insert({ project_id: project, key: 'G-1', title: 'nope' }));
    expect(rowsOf('tasks', { id: task })[0].title).not.toBe('hacked');
  });

  it('a Member without an explicit permission can edit (workspace default)', async () => {
    const project = await newProject('a');
    const task = await newTask('a', project);
    expect(okOf(await as('mem2').from('tasks').update({ title: 'by member' }).eq('id', task).select())).toHaveLength(1);
  });

  it('a Member limited to "Can view" cannot edit even though members may edit by default', async () => {
    const project = await newProject('a');
    await addProjectMember('a', project, 'mem2', 'Can view');
    const task = await newTask('a', project);
    expect((await as('mem2').from('tasks').update({ title: 'nope' }).eq('id', task).select()).data ?? []).toEqual([]);
  });

  it('Owner and Admin have full access to every non-private project', async () => {
    const project = await newProject('mem');
    const task = await newTask('mem', project);
    for (const who of ['adm', 'a']) {
      expect(
        okOf(
          await as(who)
            .from('tasks')
            .update({ title: 'by ' + who })
            .eq('id', task)
            .select(),
        ),
      ).toHaveLength(1);
    }
    expect(okOf(await as('adm').from('projects').delete().eq('id', project).select())).toHaveLength(1);
  });

  it('the project lead has full access', async () => {
    const project = await newProject('a', { row: { lead_id: memberId('mem2') } });
    // the app always lists the lead among the project members
    await addProjectMember('a', project, 'mem2', null);
    expect(okOf(await as('mem2').from('projects').update({ is_private: true }).eq('id', project).select())).toHaveLength(1);
    expect(okOf(await as('mem2').from('projects').delete().eq('id', project).select())).toHaveLength(1);
  });
});

describe.skipIf(!available)('projects: nobody can promote themselves', () => {
  const editorProject = async () => {
    const project = await newProject('a');
    await addProjectMember('a', project, 'mem2', 'Can edit');
    return project;
  };

  it('"Can edit" cannot raise their own permission to "Full access"', async () => {
    const project = await editorProject();
    const res = await as('mem2')
      .from('project_members')
      .update({ permission: 'Full access' })
      .eq('project_id', project)
      .eq('member_id', memberId('mem2'))
      .select();
    expect(res.data ?? [], `update answered: ${JSON.stringify(res.error)}`).toEqual([]);
    expect(rowsOf('project_members', { project_id: project, member_id: memberId('mem2') })[0].permission).toBe('Can edit');
  });

  it('"Can edit" cannot raise anybody else\'s permission, nor remove other people from the project', async () => {
    const project = await editorProject();
    await addProjectMember('a', project, 'gst', 'Can view');
    const res = await as('mem2')
      .from('project_members')
      .update({ permission: 'Full access' })
      .eq('project_id', project)
      .eq('member_id', memberId('gst'))
      .select();
    expect(res.data ?? []).toEqual([]);
    expect((await as('mem2').from('project_members').delete().eq('project_id', project).eq('member_id', memberId('gst')).select()).data ?? []).toEqual([]);
    expect(rowsOf('project_members', { project_id: project, member_id: memberId('gst') })[0].permission).toBe('Can view');
  });

  it('"Can edit" cannot add a person with an explicit "Full access" (or any explicit permission)', async () => {
    const project = await editorProject();
    denied(
      await as('mem2')
        .from('project_members')
        .insert({ project_id: project, member_id: memberId('gst'), permission: 'Full access' }),
    );
    denied(
      await as('mem2')
        .from('project_members')
        .insert({ project_id: project, member_id: memberId('gst'), permission: 'Can edit' }),
    );
    expect(rowsOf('project_members', { project_id: project, member_id: memberId('gst') })).toHaveLength(0);
  });

  it('"Can edit" can add a person with the default permission, and any member can leave the project', async () => {
    const project = await editorProject();
    okOf(
      await as('mem2')
        .from('project_members')
        .insert({ project_id: project, member_id: memberId('gst'), permission: null }),
    );
    expect(okOf(await as('gst').from('projects').select('id').eq('id', project))).toHaveLength(1);
    expect(okOf(await as('gst').from('project_members').delete().eq('project_id', project).eq('member_id', memberId('gst')).select())).toHaveLength(1);
  });

  it('"Can edit" cannot make themselves the project lead, nor change privacy', async () => {
    const project = await editorProject();
    const lead = await as('mem2')
      .from('projects')
      .update({ lead_id: memberId('mem2') })
      .eq('id', project);
    denied(lead, '42501');
    denied(await as('mem2').from('projects').update({ is_private: true }).eq('id', project), '42501');
    expect(rowsOf('projects', { id: project })[0]).toMatchObject({ lead_id: null, is_private: false });
    // they still cannot delete the project afterwards
    expect((await as('mem2').from('projects').delete().eq('id', project).select()).data ?? []).toEqual([]);
  });

  it('a plain Member cannot become full-access on a public project by adding themselves with a permission', async () => {
    const project = await newProject('a');
    denied(
      await as('mem2')
        .from('project_members')
        .insert({ project_id: project, member_id: memberId('mem2'), permission: 'Full access' }),
    );
    expect((await as('mem2').from('projects').delete().eq('id', project).select()).data ?? []).toEqual([]);
    expect(rowsOf('projects', { id: project })).toHaveLength(1);
  });

  it('nobody can change the workspace of a project', async () => {
    const project = await newProject('mem');
    denied(await as('mem').from('projects').update({ workspace_id: world.wsB }).eq('id', project));
    denied(await as('a').from('projects').update({ workspace_id: world.wsB }).eq('id', project));
    expect(rowsOf('projects', { id: project })[0].workspace_id).toBe(world.wsA);
  });

  it('a project key must follow the database pattern', async () => {
    denied(await as('a').from('projects').insert({ id: id(), workspace_id: world.wsA, key: 'lower', name: 'x' }), '23514');
    denied(await as('a').from('projects').insert({ id: id(), workspace_id: world.wsA, key: 'WAYTOOLONGKEY', name: 'x' }), '23514');
    denied(await as('a').from('projects').insert({ id: id(), workspace_id: world.wsA, key: 'OK', name: '   ' }), '23514');
  });
});

describe.skipIf(!available)('projects: owner access and authorship stamps', () => {
  it('the workspace owner sees and fully controls a private project made by a Member; an Admin does not see it', async () => {
    const pid = await newProject('mem', { row: { is_private: true } });
    const task = await newTask('mem', pid);
    expect(okOf(await as('a').from('projects').select('id').eq('id', pid))).toHaveLength(1);
    expect(okOf(await as('a').from('tasks').select('id').eq('id', task))).toHaveLength(1);
    expect(okOf(await as('adm').from('projects').select('id').eq('id', pid))).toEqual([]);
    expect(okOf(await as('a').from('tasks').update({ title: 'owner edit' }).eq('id', task).select())).toHaveLength(1);
    expect(okOf(await as('a').from('projects').delete().eq('id', pid).select())).toHaveLength(1);
  });

  it('created_by of tasks, events and saved views is stamped by the database and never changes', async () => {
    const project = await newProject('mem');
    const task = await newTask('mem', project, { row: { created_by: user('a').id } });
    const ev = id();
    const view = id();
    okOf(
      await as('mem')
        .from('events')
        .insert({ id: ev, workspace_id: world.wsA, project_id: project, title: 'e', event_date: '2026-01-01', created_by: user('a').id }),
    );
    okOf(
      await as('mem')
        .from('saved_views')
        .insert({ id: view, project_id: project, name: 'v', created_by: user('a').id }),
    );
    expect(rowsOf('tasks', { id: task })[0].created_by).toBe(user('mem').id);
    expect(rowsOf('events', { id: ev })[0].created_by).toBe(user('mem').id);
    expect(rowsOf('saved_views', { id: view })[0].created_by).toBe(user('mem').id);
    await as('a')
      .from('tasks')
      .update({ created_by: user('a').id, title: 'retitled' })
      .eq('id', task);
    expect(rowsOf('tasks', { id: task })[0]).toMatchObject({ created_by: user('mem').id, title: 'retitled' });
  });

  it('uploaded_by of a file is the signed-in member, whatever the client sends', async () => {
    const project = await newProject('a');
    const file = id();
    okOf(
      await as('mem')
        .from('files')
        .insert({ id: file, project_id: project, name: 'f.txt', uploaded_by: memberId('a') }),
    );
    expect(rowsOf('files', { id: file })[0].uploaded_by).toBe(memberId('mem'));
    await as('mem')
      .from('files')
      .update({ uploaded_by: memberId('a'), name: 'g.txt' })
      .eq('id', file);
    expect(rowsOf('files', { id: file })[0]).toMatchObject({ uploaded_by: memberId('mem'), name: 'g.txt' });
  });

  it('saved views can only be written by people who can edit the project', async () => {
    const project = await newProject('a');
    await addProjectMember('a', project, 'mem2', 'Can comment');
    await addProjectMember('a', project, 'gst', 'Can view');
    const view = id();
    okOf(await as('a').from('saved_views').insert({ id: view, project_id: project, name: 'shared' }));
    for (const who of ['mem2', 'gst']) {
      denied(await as(who).from('saved_views').insert({ project_id: project, name: 'nope' }));
      expect((await as(who).from('saved_views').update({ name: 'hacked' }).eq('id', view).select()).data ?? []).toEqual([]);
      expect((await as(who).from('saved_views').delete().eq('id', view).select()).data ?? []).toEqual([]);
      expect(okOf(await as(who).from('saved_views').select('id').eq('id', view))).toHaveLength(1);
    }
    expect(rowsOf('saved_views', { id: view })[0].name).toBe('shared');
  });

  it('a file cannot be attached to a task of another project', async () => {
    const p1 = await newProject('a');
    const p2 = await newProject('a');
    const task = await newTask('a', p2);
    denied(await as('a').from('files').insert({ id: id(), project_id: p1, task_id: task, name: 'x.txt' }), '23514');
  });
});
