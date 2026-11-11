/* ---------- signed image URLs for previews and thumbnails ---------- */
import { tr } from '../core/i18n.js';
import { MAX_FILE_BYTES, fileUrl } from '../data/backend.js';
import { render } from '../shell/render.js';

export const MAX_MB = Math.round(MAX_FILE_BYTES / 1048576);

/* Signed URLs last one hour; refresh a little earlier. */
const TTL = 50 * 60 * 1000;
const cache = new Map(); // storage path -> { state: 'loading' | 'ready' | 'error', url, error, at }
let timer = 0;
const redraw = () => {
  clearTimeout(timer);
  timer = setTimeout(render, 40);
};

/* Returns the current state for an image path and starts loading its signed URL on first use.
   Callers render whatever state they get; the app redraws once the URL arrives. */
export function imageState(path) {
  const hit = cache.get(path);
  if (hit && (hit.state !== 'ready' || Date.now() - hit.at < TTL)) return hit;
  const entry = { state: 'loading', url: null, error: '', at: Date.now() };
  cache.set(path, entry);
  fileUrl(path)
    .then(
      url => {
        entry.state = 'ready';
        entry.url = url;
        entry.at = Date.now();
      },
      err => {
        entry.state = 'error';
        entry.error = err?.message || tr("Couldn't load the preview.");
      },
    )
    .finally(redraw);
  return entry;
}

export function retryImage(path) {
  cache.delete(path);
  redraw();
}

/* An <img data-fpath> that the browser can't decode (corrupt file, HEIC, …) falls back to the placeholder. */
document.addEventListener(
  'error',
  e => {
    const img = e.target;
    if (!img?.matches?.('img[data-fpath]')) return;
    const entry = cache.get(img.dataset.fpath);
    if (!entry || entry.state === 'error') return;
    entry.state = 'error';
    entry.error = tr("This image can't be displayed in the browser. Download it to open it.");
    entry.broken = true;
    redraw();
  },
  true,
);
