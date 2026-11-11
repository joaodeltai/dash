/* A fake Supabase client that records every call the sync engine makes and can simulate failures.
   Only the query-builder surface the engine uses is implemented: from().upsert / update().in|match / delete().in|match,
   each optionally followed by .select(columns) (recorded as call.select). */

export function createFakeClient() {
  const calls = [];
  const rules = [];
  const hooks = { before: null };

  /* Make matching calls fail (or answer differently). `when(call)` picks the calls, `answer` is a response or a function(call). */
  function failWhen(when, answer, { times = Infinity } = {}) {
    rules.push({ when, answer, left: times });
  }

  async function settle(call) {
    calls.push(call);
    if (hooks.before) await hooks.before(call);
    const rule = rules.find(r => r.left > 0 && r.when(call));
    if (rule) {
      rule.left--;
      const answer = typeof rule.answer === 'function' ? rule.answer(call) : rule.answer;
      if (answer instanceof Error) throw answer;
      return answer;
    }
    const n = call.op === 'update' ? (call.filter.in ? call.filter.in[1].length : 1) : call.rows?.length;
    return { data: null, error: null, status: call.op === 'upsert' ? 201 : 200, count: call.op === 'upsert' ? null : (n ?? 1) };
  }

  function builder(table, op, extra) {
    const call = { table, op, ...extra, filter: {} };
    const q = {
      in(col, values) {
        call.filter.in = [col, values];
        return q;
      },
      match(obj) {
        call.filter.match = obj;
        return q;
      },
      select(cols) {
        call.select = cols;
        return q;
      },
      then(resolve, reject) {
        return settle(call).then(resolve, reject);
      },
    };
    return q;
  }

  const client = {
    from(table) {
      return {
        upsert(rows, opts) {
          return builder(table, 'upsert', { rows, opts });
        },
        update(patch, opts) {
          return builder(table, 'update', { patch, opts });
        },
        delete() {
          return builder(table, 'delete', {});
        },
      };
    },
  };

  const of = (op, table) => calls.filter(c => c.op === op && (!table || c.table === table));
  return { client, calls, failWhen, hooks, of, reset: () => (calls.length = 0), clearRules: () => (rules.length = 0) };
}

export const ok = (extra = {}) => ({ data: null, error: null, status: 200, ...extra });
export const err = (status, message = 'nope', code) => ({ data: null, error: { message, code }, status });
