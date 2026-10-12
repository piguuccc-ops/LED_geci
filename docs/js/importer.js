// Mód fájlok be- és kivitele: fájlválasztó, figyelt mappa, Windows fájltársítás,
// Android megosztás, húzd-és-ejtsd, vágólap, letöltés/megosztás.
import { kv } from './store.js';
import { parseModeFile, isModeFileName, fileNameFor } from './modes.js';

export const folderSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

let importHandler = null;   // (modes, meta) => Promise<{added, updated, same}>
let statusHandler = () => {};
export function onImport(fn) { importHandler = fn; }
export function onFolderStatus(fn) { statusHandler = fn; }

const empty = () => ({ added: 0, updated: 0, same: 0, names: [], errors: [] });
function merge(total, r) {
  total.added += r.added; total.updated += r.updated; total.same += r.same;
  total.names.push(...(r.names || []));
  total.errors.push(...(r.errors || []));
  return total;
}

// Eredmény: { added, updated, same, names: [módnevek], errors: [{ file, code }] }
export async function importText(text, meta = {}) {
  const { modes, errors } = parseModeFile(text);
  const file = meta.fileName || '';
  const r = modes.length ? await importHandler(modes, meta) : { added: 0, updated: 0, same: 0, names: [] };
  return { ...r, errors: errors.map((code) => ({ file, code })) };
}

export async function importFiles(files, source = 'file') {
  const total = empty();
  total.source = source;
  for (const f of files) {
    try { merge(total, await importText(await f.text(), { source, fileName: f.name })); }
    catch { total.errors.push({ file: f.name, code: 'parse' }); }
  }
  return total;
}

export function pickFiles() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.ledmode,.json,application/json,text/plain';
    inp.multiple = true;
    inp.onchange = () => resolve([...inp.files]);
    inp.click();
  });
}

// ------------------------------------------------------------------ figyelt mappa

const folder = { handle: null, state: 'none', lastScan: 0, timer: null, seen: new Set(), busy: false };
export const folderState = () => ({ state: folder.state, name: folder.handle?.name || '', lastScan: folder.lastScan });

function setFolderState(s) { folder.state = s; statusHandler(folderState()); }

export async function folderInit() {
  if (!folderSupported()) { setFolderState('unsupported'); return; }
  folder.seen = new Set(await kv.get('folderSeen', []));
  folder.handle = await kv.get('folderHandle', null);
  if (!folder.handle) { setFolderState('none'); return; }
  let perm = 'prompt';
  try { perm = await folder.handle.queryPermission({ mode: 'read' }); } catch { perm = 'prompt'; }
  if (perm === 'granted') startWatching();
  else setFolderState('permission');
}

export async function chooseFolder() {
  const handle = await window.showDirectoryPicker({ id: 'fenycsik-modok', mode: 'read', startIn: 'downloads' });
  folder.handle = handle;
  await kv.set('folderHandle', handle);
  // ami már a mappában van, azt is beolvassuk most (első átnézés)
  startWatching();
}

export async function regrantFolder() {
  if (!folder.handle) return chooseFolder();
  const perm = await folder.handle.requestPermission({ mode: 'read' });
  if (perm === 'granted') startWatching();
  else setFolderState('permission');
}

export async function stopFolder() {
  clearInterval(folder.timer);
  folder.handle = null;
  await kv.del('folderHandle');
  setFolderState('none');
}

function startWatching() {
  setFolderState('active');
  clearInterval(folder.timer);
  folder.timer = setInterval(() => { if (!document.hidden) scanFolder(); }, 4000);
  scanFolder();
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && folder.state === 'active') scanFolder(); });
window.addEventListener('focus', () => { if (folder.state === 'active') scanFolder(); });

export async function scanFolder() {
  if (!folder.handle || folder.busy) return null;
  folder.busy = true;
  const total = empty();
  total.source = 'folder';
  try {
    for await (const [name, entry] of folder.handle.entries()) {
      if (entry.kind !== 'file' || !isModeFileName(name)) continue;
      const file = await entry.getFile();
      const key = `${name}|${file.size}|${file.lastModified}`;
      if (folder.seen.has(key)) continue;
      folder.seen.add(key);
      merge(total, await importText(await file.text(), { source: 'folder', fileName: name }));
    }
    folder.lastScan = Date.now();
    await kv.set('folderSeen', [...folder.seen].slice(-800));
    statusHandler(folderState(), total);
  } catch (e) {
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') setFolderState('permission');
    else if (e?.name === 'NotFoundError') setFolderState('missing');
  } finally {
    folder.busy = false;
  }
  return total;
}

// ------------------------------------------------------------------ fájltársítás, megosztás, húzás

export function initLaunchQueue(report) {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async (params) => {
    if (!params.files?.length) return;
    const files = [];
    for (const fh of params.files) { try { files.push(await fh.getFile()); } catch { /* elérhetetlen */ } }
    if (files.length) report(await importFiles(files, 'open'));
  });
}

// Android "Megosztás" -> a service worker a Cache-be teszi a fájlokat, itt beolvassuk
export async function readShareInbox(report) {
  const url = new URL(location.href);
  if (!url.searchParams.has('shared') || !('caches' in window)) return;
  history.replaceState(null, '', url.pathname);
  const cache = await caches.open('fenycsik-inbox');
  const keys = await cache.keys();
  const total = empty();
  total.source = 'share';
  for (const req of keys) {
    const res = await cache.match(req);
    const text = await res.text();
    const name = decodeURIComponent(new URL(req.url).searchParams.get('name') || 'megosztott');
    merge(total, await importText(text, { source: 'share', fileName: name }));
    await cache.delete(req);
  }
  if (keys.length) report(total);
}

export function initDragDrop(target, report) {
  let depth = 0;
  target.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types?.includes('Files')) { depth++; document.body.classList.add('dropping'); } });
  target.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dropping'); });
  target.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  target.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) report(await importFiles(files, 'drop'));
  });
}

export async function importClipboard(report) {
  const text = await navigator.clipboard.readText();
  report({ ...(await importText(text, { source: 'clipboard', fileName: 'vágólap' })), source: 'clipboard' });
}

// ------------------------------------------------------------------ kivitel

export function modeFile(modes, name) {
  const data = modes.length === 1 ? modes[0] : modes;
  const text = JSON.stringify(data, null, 2) + '\n';
  return new File([text], name || fileNameFor(modes[0]?.name), { type: 'application/json' });
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const canShareFiles = (file) => !!(navigator.canShare && navigator.canShare({ files: [file] }));

export async function shareFile(file, title) {
  await navigator.share({ files: [file], title });
}
