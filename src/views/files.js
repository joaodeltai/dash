/* ---------- FILES ---------- */
import { ago, esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { tr } from '../core/i18n.js';
import { D, S, mem, task } from '../core/store.js';
import { FT, av, empty, filePrev, fileType } from '../ui/helpers.js';
import { MAX_MB } from '../ui/file-urls.js';

export function filesHtml(pid) {
  const u = S.ui;
  const q = (u.fileQ || '').toLowerCase();
  const ft = u.fileType || 'all';
  const sort = u.fileSort || 'date';
  let fs = D().files.filter(f => f.project === pid && (!q || f.name.toLowerCase().includes(q)) && (ft === 'all' || f.type === ft));
  fs.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'type' ? a.type.localeCompare(b.type) : b.at - a.at));
  const ups = (u.uploads || []).filter(x => x.project === pid);
  const view = u.fileView;
  return `<div class="toolbar">
      <div class="inwrap">${ic('search', 13)}<input class="input search-sm" id="file-q" data-in="fileQ" placeholder="${tr('Search files')}" value="${esc(u.fileQ || '')}" aria-label="${tr('Search files')}"></div>
      <select class="select" style="height:26px;width:auto;font-size:12px" data-in="fileType" aria-label="${tr('Filter by type')}"><option value="all">${tr('All types')}</option>${Object.entries(
        FT,
      )
        .filter(([k]) => k !== 'other')
        .map(([k, v]) => `<option value="${k}" ${ft === k ? 'selected' : ''}>${tr(v.n)}</option>`)
        .join('')}</select>
      <select class="select" style="height:26px;width:auto;font-size:12px" data-in="fileSort" aria-label="${tr('Sort')}">${[
        ['date', tr('Newest')],
        ['name', tr('Name')],
        ['type', tr('Type')],
      ]
        .map(([k, n]) => `<option value="${k}" ${sort === k ? 'selected' : ''}>${tr('Sort: {name}', { name: n })}</option>`)
        .join('')}</select>
      <span class="sp"></span>
      <div class="seg">${[
        ['grid', 'layout-grid'],
        ['list', 'list'],
      ]
        .map(
          ([k, i]) =>
            `<button class="${view === k ? 'on' : ''}" data-a="set" data-k="fileView" data-v="${k}" aria-label="${k === 'grid' ? tr('Grid view') : tr('List view')}">${ic(i, 13)}</button>`,
        )
        .join('')}</div>
      <label class="btn btn-primary btn-sm" style="cursor:pointer">${ic('upload', 13)}${tr('Upload')}<input type="file" multiple hidden data-in="uploadFiles" data-project="${pid}"></label>
    </div>
    <div class="page wide" style="padding-top:16px">
      <label class="dropzone" data-dropzone="${pid}" style="margin-bottom:16px">${ic('upload-cloud', 18)}<span>${tr('Drop files here or {browse} — up to {mb} MB each', { browse: `<span class="link">${tr('browse')}</span>`, mb: MAX_MB })}</span><input type="file" multiple hidden data-in="uploadFiles" data-project="${pid}"></label>
      ${ups.length ? `<div class="col" style="gap:6px;margin-bottom:16px">${ups.map(x => `<div class="upl"><span class="ftype" style="--c:${FT[fileType(x.name)].c}">${ic(FT[fileType(x.name)].i, 14)}</span><div class="grow"><div class="row"><span class="trunc" style="font-weight:500">${esc(x.name)}</span><span class="sp"></span><span class="faint num" style="font-size:11.5px" id="upct-${x.id}">${x.pct}%</span></div><div class="prog" style="margin-top:6px"><i id="upbar-${x.id}" style="--p:${x.pct / 100}"></i></div></div></div>`).join('')}</div>` : ''}
      ${
        !fs.length
          ? empty(
              q || ft !== 'all' ? 'search-x' : 'folder-open',
              q || ft !== 'all' ? tr('No results found') : tr('No files yet'),
              q || ft !== 'all' ? tr('No files match your search.') : tr('Upload designs, documents, and assets to share them with the project.'),
              '',
            )
          : view === 'grid'
            ? `<div class="fgrid">${fs.map(f => `<div class="fcard" data-ctx="file" data-id="${f.id}" data-a="previewFile" role="button" tabindex="0">${filePrev(f)}<div class="fi"><span class="fn trunc">${esc(f.name)}</span><span class="fm">${f.size} · ${esc(mem(f.by)?.name.split(' ')[0])} · ${ago(f.at)}</span></div><button class="ibtn ibtn-xs more" data-a="ctxBtn" data-ctx="file" data-id="${f.id}" aria-label="${tr('File options')}">${ic('ellipsis', 13)}</button></div>`).join('')}</div>`
            : `<div class="panel" style="overflow-x:auto"><table class="perm-t" style="min-width:680px"><thead><tr><th style="padding-left:14px">${tr('Name')}</th><th style="text-align:left">${tr('Type')}</th><th style="text-align:left">${tr('Size')}</th><th style="text-align:left">${tr('Uploaded by')}</th><th style="text-align:left">${tr('Date')}</th><th></th></tr></thead><tbody>${fs.map(f => `<tr data-ctx="file" data-id="${f.id}"><td style="padding-left:14px"><span class="row"><span class="ftype" style="--c:${FT[f.type].c}">${ic(FT[f.type].i, 14)}</span><span style="font-weight:500">${esc(f.name)}</span>${f.task && task(f.task) ? `<button class="badge" data-a="openTask" data-id="${f.task}">${ic('link', 10)}${task(f.task).key}</button>` : ''}</span></td><td style="text-align:left" class="muted">${tr(FT[f.type].n)}</td><td style="text-align:left" class="num muted">${f.size}</td><td style="text-align:left"><span class="row">${av(f.by, 'sm', false)}${esc(mem(f.by)?.name)}</span></td><td style="text-align:left" class="muted">${ago(f.at)}</td><td><button class="ibtn ibtn-sm" data-a="ctxBtn" data-ctx="file" data-id="${f.id}" aria-label="${tr('File options')}">${ic('ellipsis', 14)}</button></td></tr>`).join('')}</tbody></table></div>`
      }
    </div>`;
}
