import { afterEach, describe, expect, it } from 'vitest';
import { addProjectMember, as, available, denied, id, memberId, newComment, newProject, newTask, okOf, rowsOf, user, world } from './helpers.js';

const notifsFor = (who, task) => rowsOf('notifications', { recipient_id: memberId(who), task_id: task });
const ofType = (list, type) => list.filter(n => n.type === type);

describe.skipIf(!available)('notifications are created by the database', () => {
  afterEach(async () => {
    // make sure no test leaves a muted preference behind
    await as('mem').from('profiles').update({ notif_prefs: {} }).eq('id', user('mem').id);
  });

  describe('assignment', () => {
    it('assigning a task to somebody else notifies them, and not the person who assigned it', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem'), due_date: '2026-05-04', priority: 'high' } });
      const got = notifsFor('mem', task);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({
        type: 'assign',
        actor_id: memberId('a'),
        project_id: project,
        workspace_id: world.wsA,
        text: 'assigned you',
        read_at: null,
      });
      expect(got[0].snippet).toBe('Due May 4 · High priority');
      expect(notifsFor('a', task)).toHaveLength(0);
    });

    it('reassigning notifies the new assignee only', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem') } });
      okOf(
        await as('a')
          .from('tasks')
          .update({ assignee_id: memberId('mem2') })
          .eq('id', task),
      );
      expect(ofType(notifsFor('mem2', task), 'assign')).toHaveLength(1);
      expect(ofType(notifsFor('mem', task), 'assign')).toHaveLength(1); // only the first one
    });

    it('assigning a task to yourself notifies nobody', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('a') } });
      expect(notifsFor('a', task)).toHaveLength(0);
      expect(rowsOf('notifications', { task_id: task })).toHaveLength(0);
    });

    it('an unassigned task and an unrelated edit notify nobody', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project);
      okOf(await as('a').from('tasks').update({ title: 'renamed', priority: 'urgent' }).eq('id', task));
      expect(rowsOf('notifications', { task_id: task })).toHaveLength(0);
    });
  });

  describe('comments', () => {
    it('a comment with @Name notifies that person with a mention', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project);
      const c = await newComment('a', task, 'Can you check this, @Max Member?');
      const got = ofType(notifsFor('mem2', task), 'mention');
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ actor_id: memberId('a'), text: 'mentioned you in', snippet: 'Can you check this, @Max Member?', project_id: project });
      expect(c).toBeTruthy();
      expect(notifsFor('a', task)).toHaveLength(0);
    });

    it('does not notify the author who mentions themselves', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project);
      await newComment('mem2', task, 'note to self @Max Member');
      expect(notifsFor('mem2', task)).toHaveLength(0);
    });

    it('a comment on a task assigned to someone notifies the assignee with a "comment"', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem') } });
      await newComment('mem2', task, 'looks good to me');
      const got = ofType(notifsFor('mem', task), 'comment');
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ actor_id: memberId('mem2'), text: 'commented on', snippet: 'looks good to me' });
    });

    it('the assignee does not get a "comment" for their own comment', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem') } });
      await newComment('mem', task, 'working on it');
      expect(ofType(notifsFor('mem', task), 'comment')).toHaveLength(0);
    });

    it('a mentioned assignee gets the mention only, not a second notification', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem') } });
      await newComment('a', task, 'hey @Mia Member please look');
      const got = notifsFor('mem', task).filter(n => n.type !== 'assign');
      expect(got.map(n => n.type)).toEqual(['mention']);
    });

    it('a comment on an unassigned task without mentions notifies nobody', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project);
      await newComment('mem2', task, 'just a note');
      expect(rowsOf('notifications', { task_id: task })).toHaveLength(0);
    });
  });

  describe('status changes', () => {
    it('moving a task assigned to someone else notifies the assignee with an update', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem'), status: 'todo' } });
      okOf(await as('a').from('tasks').update({ status: 'progress' }).eq('id', task));
      const got = ofType(notifsFor('mem', task), 'update');
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ actor_id: memberId('a'), text: 'moved to In Progress', snippet: 'To Do → In Progress' });
    });

    it('completing the task says "completed"', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem'), title: 'Ship it' } });
      okOf(await as('a').from('tasks').update({ status: 'done' }).eq('id', task));
      const got = ofType(notifsFor('mem', task), 'update');
      expect(got[0]).toMatchObject({ text: 'completed', snippet: 'Ship it' });
    });

    it('the assignee moving their own task is not notified', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem') } });
      okOf(await as('mem').from('tasks').update({ status: 'review' }).eq('id', task));
      expect(ofType(notifsFor('mem', task), 'update')).toHaveLength(0);
    });

    it('moving an unassigned task, or archiving one, notifies nobody', async () => {
      const project = await newProject('a');
      const free = await newTask('a', project);
      okOf(await as('a').from('tasks').update({ status: 'progress' }).eq('id', free));
      const mine = await newTask('a', project, { row: { assignee_id: memberId('mem') } });
      okOf(await as('a').from('tasks').update({ status: 'done', archived_at: new Date().toISOString() }).eq('id', mine));
      expect(rowsOf('notifications', { task_id: free })).toHaveLength(0);
      expect(ofType(notifsFor('mem', mine), 'update')).toHaveLength(0);
    });
  });

  describe('preferences', () => {
    it('profiles.notif_prefs.inapp_assign = false suppresses assignment notifications (and only those)', async () => {
      okOf(
        await as('mem')
          .from('profiles')
          .update({ notif_prefs: { inapp_assign: false } })
          .eq('id', user('mem').id),
      );
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem') } });
      expect(ofType(notifsFor('mem', task), 'assign')).toHaveLength(0);
      // other kinds still arrive
      await newComment('a', task, 'ping @Mia Member');
      expect(ofType(notifsFor('mem', task), 'mention')).toHaveLength(1);
      // and switching it back on restores delivery
      okOf(
        await as('mem')
          .from('profiles')
          .update({ notif_prefs: { inapp_assign: true } })
          .eq('id', user('mem').id),
      );
      const task2 = await newTask('a', project, { row: { assignee_id: memberId('mem') } });
      expect(ofType(notifsFor('mem', task2), 'assign')).toHaveLength(1);
    });

    it.each([
      ['inapp_mention', 'mention'],
      ['inapp_comment', 'comment'],
      ['inapp_update', 'update'],
    ])('%s = false suppresses %s notifications', async (key, type) => {
      okOf(
        await as('mem')
          .from('profiles')
          .update({ notif_prefs: { [key]: false } })
          .eq('id', user('mem').id),
      );
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem2') } });
      okOf(
        await as('a')
          .from('tasks')
          .update({ assignee_id: memberId('mem') })
          .eq('id', task),
      );
      if (type === 'mention') await newComment('a', task, '@Mia Member hi');
      if (type === 'comment') await newComment('a', task, 'plain comment');
      if (type === 'update') okOf(await as('a').from('tasks').update({ status: 'progress' }).eq('id', task));
      expect(ofType(notifsFor('mem', task), type)).toHaveLength(0);
      expect(ofType(notifsFor('mem', task), 'assign')).toHaveLength(1);
    });
  });

  describe('privacy of the content', () => {
    it('nothing is delivered to a member who cannot see the project (private project: mention, assignment, comment)', async () => {
      const project = await newProject('a', { row: { is_private: true } });
      await addProjectMember('a', project, 'mem', null);
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem2') } });
      await newComment('a', task, 'secret plan, cc @Max Member and @Mia Member');
      expect(notifsFor('mem2', task), 'mem2 is not on the private project').toHaveLength(0);
      expect(ofType(notifsFor('mem', task), 'mention')).toHaveLength(1);
      okOf(await as('a').from('tasks').update({ status: 'progress' }).eq('id', task));
      expect(notifsFor('mem2', task)).toHaveLength(0);
    });

    it('a guest who is not on the project is not notified either', async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('gst') } });
      await newComment('a', task, 'hello @Gus Guest');
      expect(notifsFor('gst', task)).toHaveLength(0);
    });

    it('a guest who is on the project is notified', async () => {
      const project = await newProject('a');
      await addProjectMember('a', project, 'gst', 'Can comment');
      const task = await newTask('a', project);
      await newComment('a', task, 'welcome @Gus Guest');
      expect(ofType(notifsFor('gst', task), 'mention')).toHaveLength(1);
    });
  });

  describe('who can read and change them', () => {
    const fresh = async () => {
      const project = await newProject('a');
      const task = await newTask('a', project, { row: { assignee_id: memberId('mem') } });
      return { task, n: notifsFor('mem', task)[0] };
    };

    it('only the recipient reads a notification', async () => {
      const { n } = await fresh();
      expect(okOf(await as('mem').from('notifications').select('id').eq('id', n.id))).toHaveLength(1);
      for (const who of ['a', 'adm', 'mem2', 'gst', 'b']) expect(okOf(await as(who).from('notifications').select('id').eq('id', n.id)), who).toEqual([]);
      for (const who of ['a', 'adm']) {
        const all = okOf(await as(who).from('notifications').select('id, recipient_id').limit(1000));
        expect(
          all.every(r => r.recipient_id === memberId(who)),
          who,
        ).toBe(true);
      }
    });

    it('the recipient can mark it read, and read_at is the only column they can change', async () => {
      const { n } = await fresh();
      const now = new Date().toISOString();
      expect(okOf(await as('mem').from('notifications').update({ read_at: now }).eq('id', n.id).select())).toHaveLength(1);
      expect(rowsOf('notifications', { id: n.id })[0].read_at).toBeTruthy();
      okOf(await as('mem').from('notifications').update({ read_at: null }).eq('id', n.id));
      for (const patch of [
        { text: 'edited' },
        { snippet: 'edited' },
        { type: 'mention' },
        { recipient_id: memberId('a') },
        { actor_id: memberId('mem') },
        { task_id: null },
        { workspace_id: world.wsB },
      ]) {
        denied(await as('mem').from('notifications').update(patch).eq('id', n.id), '42501');
      }
      denied(await as('mem').from('notifications').update({ read_at: now, text: 'edited' }).eq('id', n.id), '42501');
      expect(rowsOf('notifications', { id: n.id })[0]).toMatchObject({ text: n.text, type: 'assign', recipient_id: memberId('mem'), read_at: null });
    });

    it('nobody else can mark it read or delete it', async () => {
      const { n } = await fresh();
      for (const who of ['a', 'adm', 'mem2', 'gst', 'b']) {
        expect((await as(who).from('notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id).select()).data ?? [], who).toEqual([]);
        expect((await as(who).from('notifications').delete().eq('id', n.id).select()).data ?? [], who).toEqual([]);
      }
      expect(rowsOf('notifications', { id: n.id })[0].read_at).toBeNull();
    });

    it('the recipient can delete their notification', async () => {
      const { n } = await fresh();
      expect(okOf(await as('mem').from('notifications').delete().eq('id', n.id).select())).toHaveLength(1);
      expect(rowsOf('notifications', { id: n.id })).toHaveLength(0);
    });

    it('nobody can create a notification through the API', async () => {
      const row = { id: id(), workspace_id: world.wsA, recipient_id: memberId('mem'), type: 'mention', text: 'forged', snippet: '' };
      for (const who of ['a', 'adm', 'mem', 'gst', 'b']) denied(await as(who).from('notifications').insert(row), '42501');
      expect(rowsOf('notifications', { id: row.id })).toHaveLength(0);
    });
  });
});
