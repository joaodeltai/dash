/* ---------- Supabase client ---------- */
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const isConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

/* OAuth providers enabled in the Supabase project (VITE_AUTH_PROVIDERS="google,azure,apple"). */
export const AUTH_PROVIDERS = String(import.meta.env.VITE_AUTH_PROVIDERS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

/* What the URL asked for, read before the client consumes (and clears) the fragment of an auth link. */
const frag = new URLSearchParams((location.hash || '').replace(/^#/, ''));
export const urlIntent = {
  recovery: frag.get('type') === 'recovery',
  invite: frag.get('type') === 'invite',
  error: frag.get('error_description') || frag.get('error') || '',
  isAuthLink: frag.has('access_token') || frag.has('error') || frag.has('error_description'),
};

/* Requests fired while the tab is being hidden (last-moment saves) must outlive the page. */
const keepaliveFetch = (input, init = {}) => {
  const small = typeof init.body !== 'string' || init.body.length < 60000;
  return fetch(input, document.visibilityState === 'hidden' && small ? { ...init, keepalive: true } : init);
};

export const sb = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'dash.auth' },
      global: { fetch: keepaliveFetch },
    })
  : null;
