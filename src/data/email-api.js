import { sb } from './supabase.js';

/* O navegador fala com a função da Vercel. A senha, quando digitada, vai
   só no corpo deste POST e não é guardada no estado nem no banco daqui. */
export async function emailApi(action, { method = 'GET', query, body } = {}) {
  if (!sb) return { ok: false, code: 'email_api_unavailable', sent: false };
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, code: 'auth_required', sent: false };
  const url = new URL(`/api/email/${action}`, location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, code: 'email_api_unavailable', sent: false };
  }
  const text = await response.text();
  try {
    const payload = JSON.parse(text);
    if (!response.ok && payload.ok !== false) return { ...payload, ok: false, code: payload.code || 'email_failed', sent: false };
    return payload;
  } catch {
    return { ok: false, code: 'email_api_unavailable', sent: false };
  }
}
