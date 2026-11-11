/* The two sources the collector can read: an Apify actor and the Google Analytics Data API (GA4).
   Only web-standard APIs are used (fetch, crypto.subtle), so this file runs on Deno and on Node alike.
   Credentials arrive as arguments and are sent in headers, never in a URL and never to a log. */
import { fillTemplate, ga4ReportToItem, type Account, type Json } from './normalize.ts';

export type Fetch = typeof fetch;

export class CollectError extends Error {}

const readBody = async (res: Response): Promise<string> => {
  try {
    return (await res.text()).slice(0, 600);
  } catch {
    return '';
  }
};

/* Runs an actor and waits for its dataset. `actor` is "user/name" (or an actor id). */
export async function runApifyActor(opt: { fetch: Fetch; base: string; token: string; actor: string; input: Json; timeoutSecs: number }): Promise<unknown[]> {
  const id = opt.actor.trim().replace('/', '~');
  if (!id) throw new CollectError('collector has no actor');
  const url = `${opt.base.replace(/\/+$/, '')}/v2/acts/${encodeURIComponent(id)}/run-sync-get-dataset-items?timeout=${opt.timeoutSecs}&clean=true&format=json`;
  let res: Response;
  try {
    res = await opt.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opt.token}` },
      body: JSON.stringify(opt.input ?? {}),
      signal: AbortSignal.timeout((opt.timeoutSecs + 10) * 1000),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    throw new CollectError(
      name === 'TimeoutError' || name === 'AbortError'
        ? `actor ${opt.actor} timed out after ${opt.timeoutSecs}s`
        : `actor ${opt.actor} could not be reached: ${e instanceof Error ? e.message : e}`,
    );
  }
  if (!res.ok) {
    const body = await readBody(res);
    let detail = body;
    try {
      const j = JSON.parse(body);
      detail = j?.error?.message || j?.error?.type || body;
    } catch {
      /* not JSON: keep the text */
    }
    throw new CollectError(`actor ${opt.actor} failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) throw new CollectError(`actor ${opt.actor} returned something that is not a list of items`);
  return data;
}

/* ---------- GA4 ---------- */

export interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const b64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let s = '';
  for (const b of raw) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export function parseServiceAccount(json: string | undefined): ServiceAccount {
  if (!json) throw new CollectError('GA4_SERVICE_ACCOUNT_JSON is not set');
  let sa: ServiceAccount;
  try {
    sa = JSON.parse(json);
  } catch {
    throw new CollectError('GA4_SERVICE_ACCOUNT_JSON is not valid JSON');
  }
  if (!sa?.client_email || !sa?.private_key) throw new CollectError('GA4_SERVICE_ACCOUNT_JSON has no client_email or private_key');
  return sa;
}

/* Exchanges the service account key for a short-lived access token (OAuth 2.0 JWT bearer flow). */
export async function googleAccessToken(opt: { fetch: Fetch; account: ServiceAccount; scope: string; now?: number }): Promise<string> {
  const tokenUri = opt.account.token_uri || 'https://oauth2.googleapis.com/token';
  const iat = Math.floor((opt.now ?? Date.now()) / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ iss: opt.account.client_email, scope: opt.scope, aud: tokenUri, iat, exp: iat + 3600 }),
  )}`;
  const pem = opt.account.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  let key: CryptoKey;
  try {
    const der = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  } catch {
    throw new CollectError('GA4 service account private key could not be read');
  }
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const res = await opt.fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) throw new CollectError(`Google did not issue an access token (HTTP ${res.status})${j?.error ? ': ' + j.error : ''}`);
  return j.access_token as string;
}

export const GA4_DEFAULT_REPORT: Json = {
  dateRanges: [{ startDate: '28daysAgo', endDate: 'yesterday' }],
  metrics: [{ name: 'activeUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
};

/* One report for one property (the account's handle is the GA4 property id). Returns one flat item. */
export async function runGa4Report(opt: {
  fetch: Fetch;
  base: string;
  accessToken: string;
  account: Pick<Account, 'handle' | 'url'>;
  template: Json;
  timeoutSecs: number;
}): Promise<unknown[]> {
  const property = opt.account.handle.trim().replace(/^properties\//, '');
  if (!/^\d+$/.test(property)) throw new CollectError(`"${opt.account.handle}" is not a GA4 property id (digits only)`);
  const template =
    opt.template && typeof opt.template === 'object' && !Array.isArray(opt.template) && Object.keys(opt.template).length ? opt.template : GA4_DEFAULT_REPORT;
  const res = await opt.fetch(`${opt.base.replace(/\/+$/, '')}/v1beta/properties/${property}:runReport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opt.accessToken}` },
    body: JSON.stringify(fillTemplate(template, [opt.account])),
    signal: AbortSignal.timeout(opt.timeoutSecs * 1000),
  });
  if (!res.ok) {
    const body = await readBody(res);
    let detail = body;
    try {
      detail = JSON.parse(body)?.error?.message || body;
    } catch {
      /* not JSON: keep the text */
    }
    throw new CollectError(`GA4 report for property ${property} failed (HTTP ${res.status})${detail ? ': ' + detail : ''}`);
  }
  const item = ga4ReportToItem(await res.json().catch(() => null));
  return Object.keys(item).length ? [item] : [];
}
