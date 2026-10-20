// Drag & drop helpers shared by every module.
//   filesFromDrop(dataTransfer)        Files from a drop, folders walked recursively (relPath kept,
//                                      e.g. "Album/01.flac"), so a dropped folder imports like a picked one.
//   dropFiles(el, { onFiles, accept, overlay, filter })   file drop target (whole page or one element);
//                                      shows an overlay while files hover; returns an off() function.
//   setPayload(e, type, data) / getPayload(e, type) / hasPayload(e, type)   in-app drags
//                                      (songs onto playlists / the queue, …), MIME 'application/x-hub-<type>'.
const MIME = (type) => 'application/x-hub-' + type;

export function setPayload(e, type, data, { label } = {}) {
  try {
    e.dataTransfer.setData(MIME(type), JSON.stringify(data));
    e.dataTransfer.setData('text/plain', label || '');
    e.dataTransfer.effectAllowed = 'copyMove';
  } catch { /* old browsers */ }
  current = { type, data };
}
let current = null;   // payload of the drag in progress (dragover cannot read data, only types)
addEventListener('dragend', () => { current = null; }, true);
addEventListener('drop', () => setTimeout(() => { current = null; }, 0), true);
export const hasPayload = (e, type) => !!e.dataTransfer?.types?.includes(MIME(type));
export function getPayload(e, type) {
  try { const s = e.dataTransfer.getData(MIME(type)); if (s) return JSON.parse(s); } catch { /* ignore */ }
  return current?.type === type ? current.data : null;
}
export const hasFiles = (e) => !!e.dataTransfer?.types?.includes('Files');

export async function filesFromDrop(dt) {
  const items = [...(dt.items || [])].filter(i => i.kind === 'file');
  const entries = items.map(i => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length || !entries.some(e => e.isDirectory)) return [...(dt.files || [])];
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const f = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
      if (f) { try { Object.defineProperty(f, 'relPath', { value: prefix + f.name }); } catch { f.relPath = prefix + f.name; } out.push(f); }
      return;
    }
    const reader = entry.createReader();
    for (;;) {   // readEntries returns batches (100 in Chrome): keep reading until empty, no cap
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej)).catch(() => []);
      if (!batch.length) break;
      for (const e of batch) await walk(e, prefix + entry.name + '/');
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

// el: element (or window) receiving the drop. overlay: text shown while hovering (page-wide when el is window).
export function dropFiles(el, { onFiles, overlay = 'Thả tệp vào đây', filter = null, when = () => true } = {}) {
  let depth = 0, ov = null;
  const target = el === window ? document.body : el;
  const show = (on) => {
    if (on && !ov) {
      ov = document.createElement('div');
      ov.className = 'hub-drop' + (el === window ? ' page' : '');
      ov.innerHTML = `<div class="hub-drop-card">${overlay}</div>`;
      (el === window ? document.body : el).appendChild(ov);
    } else if (!on && ov) { ov.remove(); ov = null; }
  };
  const ok = (e) => hasFiles(e) && when(e);
  const enter = (e) => { if (!ok(e)) return; depth++; show(true); };
  const leave = (e) => { if (!ok(e)) return; if (--depth <= 0) { depth = 0; show(false); } };
  const over = (e) => { if (!ok(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const drop = async (e) => {
    if (!ok(e)) return;
    e.preventDefault(); depth = 0; show(false);
    let files = await filesFromDrop(e.dataTransfer);
    if (filter) files = files.filter(filter);
    if (files.length) onFiles(files, e);
  };
  const t = el === window ? window : target;
  // A drop handled by an inner target (stopPropagation) still has to clear the overlay.
  const reset = () => { depth = 0; show(false); };
  window.addEventListener('drop', reset, true); window.addEventListener('dragend', reset, true);
  t.addEventListener('dragenter', enter); t.addEventListener('dragleave', leave);
  t.addEventListener('dragover', over); t.addEventListener('drop', drop);
  return () => { show(false); window.removeEventListener('drop', reset, true); window.removeEventListener('dragend', reset, true); t.removeEventListener('dragenter', enter); t.removeEventListener('dragleave', leave); t.removeEventListener('dragover', over); t.removeEventListener('drop', drop); };
}
