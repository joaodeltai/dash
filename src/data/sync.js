/* =====================================================================
   SYNC ENGINE: persists the in-memory workspace to Supabase.

   Actions keep mutating `S.data` synchronously (the UI stays instant). Every
   `save()` schedules a cycle here that:
     1. normalizes the state and flattens it into rows,
     2. diffs those rows against the last state known to be in the database,
     3. sends only the differences: inserts, per-column updates, deletes.

   Deletes wait a few seconds before they are sent, so "Undo" (which restores a
   full snapshot) simply cancels them instead of having to re-create rows.
   ===================================================================== */
import { TABLES, TABLE, diff, flatten, keyOf, normalize } from './mappers.js';

const DEBOUNCE_MS = 250;
export const DELETE_HOLD_MS = 6000;
const CHUNK = 200;
const PARALLEL = 6;
const RETRY_MS = [1500, 3000, 6000, 12000, 30000];

export function createSync({ getClient, getContext, getState, onStatus, onRejected, onAuthLost, onDeletedFiles, onServerValues }) {
  let baseline = null;
  let timer = null;
  let holdTimer = null;
  let retryTimer = null;
  let running = null;
  let retries = 0;
  let status = 'idle';
  let generation = 0;
  const heldSince = new Map();

  const setStatus = s => {
    if (s === status) return;
    status = s;
    onStatus?.(s);
  };

  function setBaseline(flat) {
    generation++;
    baseline = flat;
    heldSince.clear();
    clearTimeout(timer);
    clearTimeout(holdTimer);
    clearTimeout(retryTimer);
    retries = 0;
    setStatus('idle');
  }

  function current() {
    const ctx = getContext();
    const state = getState();
    if (!baseline || !ctx?.wsId || !state?.data) return null;
    normalize(state.data);
    return flatten(state, ctx);
  }

  /* Number of changes not yet in the database (including deletes still on hold). */
  function pending() {
    const cur = current();
    return cur ? diff(baseline, cur).count : 0;
  }

  function schedule(ms = DEBOUNCE_MS) {
    if (!baseline) return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  }

  /* Runs cycles until nothing is left to send. `force` also sends deletes that are still on hold. */
  function flush({ force = false } = {}) {
    // A cycle in flight re-reads the state before it ends, but a new one is queued to be sure nothing is missed.
    if (running) return running.then(() => flush({ force }));
    clearTimeout(timer);
    running = cycle(force).finally(() => {
      running = null;
    });
    return running;
  }

  async function cycle(force) {
    const gen = generation;
    try {
      for (let guard = 0; guard < 20; guard++) {
        const cur = current();
        if (!cur) return;
        const { ops } = diff(baseline, cur);
        const sendable = applyHold(ops, force);
        if (!sendable) break;
        setStatus('saving');
        await send(sendable, gen);
        if (gen !== generation) return;
        // loop again: the state may have changed while requests were in flight
      }
      retries = 0;
      if (gen === generation) setStatus('idle');
    } catch (err) {
      if (gen !== generation) return;
      handleError(err);
    }
  }

  /* Splits out deletes that are still inside the undo window. Returns null when nothing can be sent yet. */
  function applyHold(ops, force) {
    const now = Date.now();
    const live = new Set();
    let earliest = Infinity;
    let any = false;
    const out = {};
    for (const { name, mode, deletable } of TABLES) {
      const o = ops[name];
      if (!o) continue;
      const canDelete = mode === 'full' || deletable;
      const sendDeletes = [];
      for (const del of o.deletes) {
        if (!canDelete) {
          sendDeletes.push(del); // dropped from the baseline only (the database removes these itself)
          continue;
        }
        const id = name + '|' + del.key;
        live.add(id);
        if (!heldSince.has(id)) heldSince.set(id, now);
        const releaseAt = heldSince.get(id) + DELETE_HOLD_MS;
        // a pending insert in the same table may need the slot the delete frees (unique constraints)
        if (force || releaseAt <= now || o.inserts.length) sendDeletes.push(del);
        else earliest = Math.min(earliest, releaseAt);
      }
      if (o.inserts.length || o.updates.length || sendDeletes.length) {
        out[name] = { inserts: o.inserts, updates: o.updates, deletes: sendDeletes };
        any = true;
      }
    }
    for (const id of [...heldSince.keys()]) if (!live.has(id)) heldSince.delete(id);
    clearTimeout(holdTimer);
    if (earliest !== Infinity) holdTimer = setTimeout(() => void flush(), Math.max(50, earliest - now + 20));
    return any ? out : null;
  }

  /* Columns the database decides (a task's key): what it returned replaces what was sent, in the baseline and,
     through onServerValues, in the in-memory state. */
  function adopt(name, pk, server, returned) {
    const base = baseline[name];
    const changed = [];
    for (const got of returned || []) {
      const key = keyOf(name, got);
      const row = base.get(key);
      if (!row) continue;
      const diffCols = server.filter(col => got[col] !== undefined && got[col] !== row[col]);
      if (diffCols.length) base.set(key, { ...row, ...Object.fromEntries(diffCols.map(col => [col, got[col]])) });
      changed.push(got);
    }
    if (changed.length) onServerValues?.(name, changed);
  }

  async function send(ops, gen) {
    const sb = getClient();
    // inserts and updates: parents first
    for (const { name, pk, mode, server, serverOn } of TABLES) {
      const o = ops[name];
      if (!o) continue;
      const base = baseline[name];
      const returning = server ? [...pk, ...server].join(',') : null;
      if (o.inserts.length) {
        if (mode === 'update') {
          for (const row of o.inserts) base.set(keyOf(name, row), row);
        } else {
          for (let i = 0; i < o.inserts.length; i += CHUNK) {
            const rows = o.inserts.slice(i, i + CHUNK);
            let q = sb.from(name).upsert(rows, { onConflict: pk.join(','), ignoreDuplicates: true });
            if (returning) q = q.select(returning);
            const res = await q;
            check(res, name, 'insert');
            if (gen !== generation) return;
            for (const row of rows) base.set(keyOf(name, row), row);
            if (returning) adopt(name, pk, server, res.data);
          }
        }
      }
      if (o.updates.length) {
        if (mode === 'insert') {
          for (const u of o.updates) base.set(u.key, u.row);
        } else {
          await pool(groupUpdates(o.updates, pk), PARALLEL, async g => {
            let q = sb.from(name).update(g.patch, { count: 'exact' });
            q =
              pk.length === 1
                ? q.in(
                    pk[0],
                    g.items.map(u => u.row[pk[0]]),
                  )
                : q.match(pkOf(pk, g.items[0].row));
            const readBack = returning && Object.keys(g.patch).some(col => (serverOn || server).includes(col));
            if (readBack) q = q.select(returning);
            const res = await q;
            check(res, name, 'update');
            if (gen !== generation) return;
            if (typeof res.count === 'number' && res.count < g.items.length)
              throw rejected(name, 'update', { message: 'The item no longer exists or you do not have permission to change it.', code: 'NOT_UPDATED' });
            for (const u of g.items) base.set(u.key, u.row);
            if (readBack) adopt(name, pk, server, res.data);
          });
        }
      }
    }
    // deletes: children first
    // A project deleted in this cycle takes its tasks with it (cascade). Deleting them one by one first would
    // record each as a separate "deleted" entry in the history, on top of the one for the project.
    const doomedProjects = new Set((ops.projects?.deletes || []).map(x => x.row.id));
    for (const { name, pk, mode, deletable } of [...TABLES].reverse()) {
      const o = ops[name];
      if (!o?.deletes.length) continue;
      const base = baseline[name];
      if (name === 'tasks' && doomedProjects.size) {
        const cascaded = o.deletes.filter(x => doomedProjects.has(x.row.project_id));
        for (const x of cascaded) base.delete(x.key);
        o.deletes = o.deletes.filter(x => !doomedProjects.has(x.row.project_id));
        if (!o.deletes.length) continue;
      }
      if (mode === 'full' || deletable) {
        if (pk.length === 1) {
          for (let i = 0; i < o.deletes.length; i += CHUNK) {
            const part = o.deletes.slice(i, i + CHUNK);
            const res = await sb
              .from(name)
              .delete()
              .in(
                pk[0],
                part.map(x => x.row[pk[0]]),
              );
            check(res, name, 'delete');
            if (gen !== generation) return;
            for (const x of part) base.delete(x.key);
          }
        } else {
          await pool(o.deletes, PARALLEL, async x => {
            const res = await sb.from(name).delete().match(pkOf(pk, x.row));
            check(res, name, 'delete');
            if (gen === generation) base.delete(x.key);
          });
        }
        if (name === 'files') {
          const paths = o.deletes.map(x => x.row.storage_path).filter(Boolean);
          if (paths.length) onDeletedFiles?.(paths);
        }
      } else {
        for (const x of o.deletes) base.delete(x.key);
      }
    }
  }

  function handleError(err) {
    if (err?.kind === 'rejected') {
      retries = 0;
      setStatus('error');
      onRejected?.(err);
      return;
    }
    if (err?.kind === 'auth') {
      setStatus('error');
      onAuthLost?.(err);
      return;
    }
    // network or server trouble: keep the changes queued and retry
    setStatus('offline');
    const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
    retries++;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void flush(), wait);
  }

  return {
    setBaseline,
    schedule,
    flush,
    pending,
    isRunning: () => !!running,
    hasBaseline: () => !!baseline,
    baselineRow: (table, key) => baseline?.[table]?.get(key),
    status: () => status,
    stop() {
      generation++;
      baseline = null;
      heldSince.clear();
      clearTimeout(timer);
      clearTimeout(holdTimer);
      clearTimeout(retryTimer);
      status = 'idle';
    },
  };
}

/* ---------- helpers ---------- */
const pkOf = (pk, row) => Object.fromEntries(pk.map(k => [k, row[k]]));

/* Rows that receive the exact same patch go in one request (bulk edits). */
function groupUpdates(updates, pk) {
  if (pk.length > 1) return updates.map(u => ({ patch: u.patch, items: [u] }));
  const groups = new Map();
  for (const u of updates) {
    const sig = JSON.stringify(u.patch);
    if (!groups.has(sig)) groups.set(sig, { patch: u.patch, items: [] });
    groups.get(sig).items.push(u);
  }
  const out = [];
  for (const g of groups.values()) for (let i = 0; i < g.items.length; i += CHUNK) out.push({ patch: g.patch, items: g.items.slice(i, i + CHUNK) });
  return out;
}

async function pool(items, size, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

export function classify(error, httpStatus) {
  const msg = String(error?.message || '');
  if (httpStatus === 401 || error?.code === 'PGRST301' || /jwt expired|invalid jwt/i.test(msg)) return 'auth';
  if (
    !httpStatus ||
    httpStatus >= 500 ||
    httpStatus === 408 ||
    httpStatus === 429 ||
    /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(msg)
  )
    return 'network';
  return 'rejected';
}

function rejected(table, op, error) {
  const e = new Error(error?.message || 'Rejected');
  e.kind = 'rejected';
  e.table = table;
  e.op = op;
  e.code = error?.code;
  e.details = error?.details;
  return e;
}

function check(res, table, op) {
  if (!res?.error) return;
  const kind = classify(res.error, res.status);
  if (kind === 'rejected') throw rejected(table, op, res.error);
  const e = new Error(res.error.message || 'Request failed');
  e.kind = kind;
  e.table = table;
  e.op = op;
  throw e;
}

export { TABLE };
