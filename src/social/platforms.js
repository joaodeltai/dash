/* ---------- SOCIAL MEDIA · networks ----------
   The networks the screen knows by name. The database accepts any network id (lower case letters, digits and "_"),
   so a network missing here still works: it is shown by its id. */
import { tr } from '../core/i18n.js';

/* audience: what the main number of the network is called. */
export const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', mark: 'IG', audience: 'followers', profile: h => `https://www.instagram.com/${h}/` },
  { id: 'tiktok', name: 'TikTok', mark: 'TT', audience: 'followers', profile: h => `https://www.tiktok.com/@${h}` },
  { id: 'youtube', name: 'YouTube', mark: 'YT', audience: 'subscribers', profile: h => `https://www.youtube.com/@${h}` },
  { id: 'facebook', name: 'Facebook', mark: 'FB', audience: 'followers', profile: h => `https://www.facebook.com/${h}` },
  { id: 'linkedin', name: 'LinkedIn', mark: 'IN', audience: 'followers', profile: h => `https://www.linkedin.com/company/${h}/` },
  { id: 'x', name: 'X', mark: 'X', audience: 'followers', profile: h => `https://x.com/${h}` },
  { id: 'threads', name: 'Threads', mark: 'TH', audience: 'followers', profile: h => `https://www.threads.net/@${h}` },
  { id: 'pinterest', name: 'Pinterest', mark: 'PI', audience: 'followers', profile: h => `https://www.pinterest.com/${h}/` },
  { id: 'substack', name: 'Substack', mark: 'SB', audience: 'subscribers', profile: h => `https://${h}.substack.com` },
  { id: 'website', name: 'Website', mark: 'WEB', audience: 'users', profile: () => '' },
];
const BY_ID = Object.fromEntries(PLATFORMS.map(p => [p.id, p]));

export const platformOf = id =>
  BY_ID[id] || {
    id,
    name: String(id || ''),
    mark: String(id || '?')
      .slice(0, 2)
      .toUpperCase(),
    audience: 'followers',
    profile: () => '',
  };
export const platformName = id => (id === 'website' ? tr('Website') : platformOf(id).name);
export function audienceLabel(id) {
  const kind = platformOf(id).audience;
  return kind === 'subscribers' ? tr('Subscribers') : kind === 'users' ? tr('Active users (28 days)') : tr('Followers');
}
/* What to type as the account of each network. */
export function handleHint(id) {
  if (id === 'website') return tr('The GA4 property ID, digits only (e.g. 123456789).');
  if (id === 'substack') return tr('The publication address without ".substack.com" (e.g. mynewsletter).');
  if (id === 'linkedin') return tr('The company page name as it appears in its address (e.g. my-company).');
  return tr('The user name, without "@" (e.g. mybrand).');
}
/* A link to the account: the address typed by the person when there is one, the network's usual address otherwise.
   Only http(s) links are returned. */
export function profileUrl(account) {
  const typed = String(account.url || '').trim();
  const built = platformOf(account.platform).profile(encodeURIComponent(String(account.handle || '').replace(/^@/, '')));
  const url = typed || built;
  return /^https?:\/\//i.test(url) ? url : '';
}
