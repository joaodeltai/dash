/* Hash da URL (#/crm/email) sem depender do DOM. O shell reexporta daqui. */

export function routeHash(route, params = {}) {
  let h = '#/' + route;
  if (route === 'crm') {
    if (params.tab && params.tab !== 'pipeline') h += '/' + encodeURIComponent(params.tab);
    return h;
  }
  if (route === 'content') {
    if (params.id) return '#/content/item/' + encodeURIComponent(params.id);
    if (params.tab && params.tab !== 'ideas') h += '/' + encodeURIComponent(params.tab);
    return h;
  }
  if (params.id) {
    h += '/' + encodeURIComponent(params.id);
    if (params.tab) h += '/' + encodeURIComponent(params.tab);
  }
  return h;
}

export function parseHash(hash, isKnown) {
  const parts = String(hash || '')
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(x => {
      try {
        return decodeURIComponent(x);
      } catch {
        return x;
      }
    });
  if (!parts.length) return null;
  const [route, id, tab] = parts;
  if (route === 'task') return id ? { task: id } : null;
  if (route === 'crm') {
    const params = {};
    if (id) params.tab = id;
    return { route, params };
  }
  if (route === 'content') {
    if (!isKnown(route)) return null;
    const params = {};
    if (id === 'item' && tab) params.id = tab;
    else if (id) params.tab = id;
    return { route, params };
  }
  if (route !== 'project' && !isKnown(route)) return null;
  const params = {};
  if (id) params.id = id;
  if (tab) params.tab = tab;
  return { route, params };
}
