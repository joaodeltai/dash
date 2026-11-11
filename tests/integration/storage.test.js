import { afterAll, describe, expect, it } from 'vitest';
import { addProjectMember, admin, anon, as, available, denied, id, newProject, okOf, query, user, world } from './helpers.js';

const uploaded = new Set();
const pathIn = (project, name = 'note.txt', ws = world.wsA) => `${ws}/${project}/${id()}/${name}`;
const put = (who, path, text = 'hello') =>
  as(who)
    .storage.from('files')
    .upload(path, new Blob([text]), { contentType: 'text/plain' });
const upload = async (who, path, text) => {
  const res = await put(who, path, text);
  if (!res.error) uploaded.add(path);
  return res;
};
const read = async (who, path) => {
  const res = await as(who).storage.from('files').download(path);
  return res.error ? { error: res.error } : { text: await res.data.text() };
};
const stored = path => query(`select count(*)::int as n from storage.objects where bucket_id = 'files' and name = '${path.replace(/'/g, "''")}'`)[0].n;

describe.skipIf(!available)('storage bucket "files"', () => {
  afterAll(async () => {
    if (uploaded.size)
      await admin()
        .storage.from('files')
        .remove([...uploaded]);
  });

  it('the bucket is private', () => {
    const [bucket] = query(`select public, file_size_limit from storage.buckets where id = 'files'`);
    expect(bucket.public).toBe(false);
    expect(Number(bucket.file_size_limit)).toBe(52428800);
  });

  describe('members of the workspace', () => {
    it('a member uploads a file and every member that can see the project downloads it', async () => {
      const project = await newProject('a');
      const path = pathIn(project);
      okOf(await upload('mem', path, 'shared content'), 'upload');
      for (const who of ['mem', 'mem2', 'adm', 'a']) expect(await read(who, path), who).toEqual({ text: 'shared content' });
    });

    it('a member can create a signed URL and list the folder of a project they can see', async () => {
      const project = await newProject('a');
      const path = pathIn(project, 'listed.txt');
      okOf(await upload('a', path));
      const signed = okOf(await as('mem2').storage.from('files').createSignedUrl(path, 60));
      const body = await (await fetch(signed.signedUrl)).text();
      expect(body).toBe('hello');
      const dir = path.split('/').slice(0, 3).join('/');
      const listed = okOf(await as('mem2').storage.from('files').list(dir));
      expect(listed.map(o => o.name)).toContain('listed.txt');
    });

    it('a second upload to the same path is refused unless upsert is asked for', async () => {
      const project = await newProject('a');
      const path = pathIn(project);
      okOf(await upload('a', path, 'one'));
      denied(await put('a', path, 'two'));
      expect(await read('a', path)).toEqual({ text: 'one' });
    });

    it('a member can remove a file of a project they can edit', async () => {
      const project = await newProject('a');
      const path = pathIn(project);
      okOf(await upload('mem', path));
      const res = okOf(await as('mem2').storage.from('files').remove([path]));
      expect(res).toHaveLength(1);
      expect(stored(path)).toBe(0);
    });
  });

  describe('people of another workspace', () => {
    it('cannot download, sign, list or overwrite a file of workspace A, and cannot upload next to it', async () => {
      const project = await newProject('a');
      const path = pathIn(project, 'private.txt');
      okOf(await upload('a', path, 'confidential'));
      const b = as('b').storage.from('files');
      denied(await b.download(path));
      denied(await b.createSignedUrl(path, 60));
      const dir = path.split('/').slice(0, 3).join('/');
      expect(okOf(await b.list(dir))).toEqual([]);
      expect(okOf(await b.list(world.wsA))).toEqual([]);
      denied(await put('b', pathIn(project, 'planted.txt')));
      denied(await b.upload(path, new Blob(['overwritten']), { upsert: true }));
      expect(okOf(await b.remove([path]))).toEqual([]);
      expect(await read('a', path)).toEqual({ text: 'confidential' });
    });

    it('cannot copy or move a file out of workspace A, nor into it', async () => {
      const project = await newProject('a');
      const path = pathIn(project);
      okOf(await upload('a', path));
      const projectB = id();
      okOf(
        await as('b')
          .from('projects')
          .insert({ id: projectB, workspace_id: world.wsB, key: 'BST', name: 'b storage', created_by: user('b').id }),
      );
      const own = pathIn(projectB, 'own.txt', world.wsB);
      okOf(await upload('b', own, 'b file'), 'B can use its own workspace');
      denied(
        await as('b')
          .storage.from('files')
          .copy(path, pathIn(projectB, 'stolen.txt', world.wsB)),
      );
      denied(await as('a').storage.from('files').copy(own, pathIn(project, 'x.txt')));
      denied(await as('b').storage.from('files').copy(own, pathIn(project, 'planted.txt')));
    });

    it('B can of course use its own workspace (control)', async () => {
      const projectB = id();
      okOf(
        await as('b')
          .from('projects')
          .insert({ id: projectB, workspace_id: world.wsB, key: 'BCT', name: 'control', created_by: user('b').id }),
      );
      const path = pathIn(projectB, 'mine.txt', world.wsB);
      okOf(await upload('b', path, 'mine'));
      expect(await read('b', path)).toEqual({ text: 'mine' });
      expect((await read('a', path)).error).toBeTruthy();
    });
  });

  describe('permission per project', () => {
    it('a Guest who is not on the project cannot read, list or upload', async () => {
      const project = await newProject('a');
      const path = pathIn(project);
      okOf(await upload('a', path));
      expect((await read('gst', path)).error).toBeTruthy();
      expect(okOf(await as('gst').storage.from('files').list(path.split('/').slice(0, 3).join('/')))).toEqual([]);
      denied(await put('gst', pathIn(project)));
    });

    it.each([
      ['Can view', false],
      ['Can comment', false],
      ['Can edit', true],
      ['Full access', true],
    ])('a Guest with "%s" can download, and can upload: %s', async (permission, canUpload) => {
      const project = await newProject('a');
      await addProjectMember('a', project, 'gst', permission);
      const existing = pathIn(project);
      okOf(await upload('a', existing, 'for the guest'));
      expect(await read('gst', existing)).toEqual({ text: 'for the guest' });
      const mine = pathIn(project, 'guest.txt');
      const res = await upload('gst', mine);
      if (canUpload) {
        okOf(res);
        expect(stored(mine)).toBe(1);
      } else {
        denied(res);
        expect(stored(mine)).toBe(0);
        expect(okOf(await as('gst').storage.from('files').remove([existing]))).toEqual([]);
        expect(stored(existing)).toBe(1);
      }
    });

    it('a Member limited to "Can view" can download but not upload nor delete', async () => {
      const project = await newProject('a');
      await addProjectMember('a', project, 'mem2', 'Can view');
      const path = pathIn(project);
      okOf(await upload('a', path));
      expect((await read('mem2', path)).text).toBe('hello');
      denied(await put('mem2', pathIn(project)));
      expect(okOf(await as('mem2').storage.from('files').remove([path]))).toEqual([]);
      expect(stored(path)).toBe(1);
    });

    it('files of a private project are invisible to workspace members who are not on it', async () => {
      const project = await newProject('a', { row: { is_private: true } });
      await addProjectMember('a', project, 'mem', 'Can edit');
      const path = pathIn(project);
      okOf(await upload('mem', path, 'private file'));
      expect(await read('mem', path)).toEqual({ text: 'private file' });
      for (const who of ['mem2', 'adm', 'gst']) {
        expect((await read(who, path)).error, who).toBeTruthy();
        denied(await put(who, pathIn(project)));
      }
    });
  });

  describe('malformed paths are refused', () => {
    const cases = () => {
      const project = world.seed.project;
      return {
        'a bare file name': 'file.txt',
        'workspace only': `${world.wsA}/file.txt`,
        'workspace and project only': `${world.wsA}/${project}/file.txt`,
        'a workspace that is not a uuid': `not-a-uuid/${project}/${id()}/file.txt`,
        'a project that is not a uuid': `${world.wsA}/not-a-uuid/${id()}/file.txt`,
        'a project that does not exist': `${world.wsA}/${id()}/${id()}/file.txt`,
        'a workspace that does not exist': `${id()}/${project}/${id()}/file.txt`,
        'a project from a different workspace': `${world.wsB}/${project}/${id()}/file.txt`,
      };
    };
    it.each([
      'a bare file name',
      'workspace only',
      'workspace and project only',
      'a workspace that is not a uuid',
      'a project that is not a uuid',
      'a project that does not exist',
      'a workspace that does not exist',
      'a project from a different workspace',
    ])('%s', async label => {
      const path = cases()[label];
      for (const who of ['a', 'mem']) {
        denied(await upload(who, path));
        expect(stored(path), who).toBe(0);
      }
    });

    it('a well formed path in the right project is accepted (control)', async () => {
      const path = pathIn(world.seed.project, 'ok.txt');
      okOf(await upload('a', path));
      expect(stored(path)).toBe(1);
    });

    it('a path with an empty segment is not accepted as another project', async () => {
      const path = `${world.wsA}/${world.seed.project}//file.txt`;
      const res = await upload('a', path);
      // either refused, or stored under the right project: it must never land outside the project folder
      if (!res.error) expect(path.startsWith(`${world.wsA}/${world.seed.project}/`)).toBe(true);
    });
  });

  describe('anonymous callers', () => {
    it('cannot see the objects uploaded in this run', async () => {
      const project = await newProject('a');
      const path = pathIn(project);
      okOf(await upload('a', path));
      denied(await anon().storage.from('files').download(path));
    });
  });
});
