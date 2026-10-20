// Local adapter: stores file bytes on this device.
// Priority: OPFS (Origin Private File System, fast, large) -> IndexedDB blobs (fallback).
// Also supports "linked" files: a FileSystemFileHandle pointing at the user's own folder
// (desktop Chrome/Edge), so big libraries don't get copied.
import { db } from '../db.js';

const CHUNK = 8 * 1024 * 1024;
let opfsRoot = null;
let opfsWrites = true; // turned off for the session if an OPFS write stalls or fails
async function opfs() {
  if (opfsRoot !== null) return opfsRoot;
  try {
    const root = await navigator.storage.getDirectory();
    opfsRoot = await root.getDirectoryHandle('files', { create: true });
  } catch { opfsRoot = false; }
  return opfsRoot;
}

async function writeOpfs(dir, fileId, blob, { onProgress, signal } = {}) {
  const fh = await dir.getFileHandle(fileId, { create: true });
  const w = await fh.createWritable();
  // Write in ArrayBuffer chunks so memory stays flat for large files.
  try {
    for (let off = 0; off < blob.size; off += CHUNK) {
      if (signal?.aborted) throw signal.reason || new DOMException('Đã huỷ', 'AbortError');
      await w.write(await blob.slice(off, off + CHUNK).arrayBuffer());
      onProgress?.(Math.min(blob.size, off + CHUNK), blob.size);
    }
  } catch (e) { await w.abort?.().catch(() => {}); throw e; }
  await w.close();
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

export const local = {
  id: 'local',
  label: 'Thiết bị này',

  async available() { return true; },

  async backend() { return opfsWrites && (await opfs()) ? 'opfs' : 'indexeddb'; },

  // Copy a Blob/File into app storage. Returns a location object saved in files.locations.local
  // onProgress(writtenBytes, totalBytes) after each 8 MB chunk; signal (AbortSignal) stops between chunks.
  async put(fileId, blob, { onProgress, signal } = {}) {
    const dir = opfsWrites && await opfs();
    if (dir) {
      try {
        await withTimeout(writeOpfs(dir, fileId, blob, { onProgress, signal }), 15000 + blob.size / 2000);
        return { kind: 'opfs', ref: fileId, size: blob.size };
      } catch (e) {
        if (e?.name === 'AbortError') { dir.removeEntry(fileId).catch(() => {}); throw e; }
        // OPFS writes can stall or be refused (some private profiles, sandboxed frames).
        // Stop using OPFS for this session and keep the bytes in IndexedDB instead.
        console.warn('OPFS write failed, using IndexedDB', e);
        opfsWrites = false;
        dir.removeEntry(fileId).catch(() => {});
      }
    }
    await db.blobs.put({ id: fileId, blob });
    onProgress?.(blob.size, blob.size);
    return { kind: 'idb', ref: fileId, size: blob.size };
  },

  // Keep a reference to a file on disk instead of copying it.
  async link(fileId, handle) {
    await db.handles.put({ id: fileId, handle });
    return { kind: 'handle', ref: fileId };
  },

  async get(loc) {
    if (!loc) return null;
    if (loc.kind === 'opfs') {
      const dir = await opfs();
      if (!dir) return null;
      try { return await (await dir.getFileHandle(loc.ref)).getFile(); } catch { return null; }
    }
    if (loc.kind === 'idb') return (await db.blobs.get(loc.ref))?.blob || null;
    if (loc.kind === 'handle') {
      const row = await db.handles.get(loc.ref);
      if (!row) return null;
      const h = row.handle;
      if (h.queryPermission && (await h.queryPermission({ mode: 'read' })) !== 'granted') {
        if ((await h.requestPermission({ mode: 'read' })) !== 'granted') return null;
      }
      return h.getFile();
    }
    if (loc.kind === 'url') return (await fetch(loc.ref)).blob();
    return null;
  },

  async remove(loc) {
    if (!loc) return;
    if (loc.kind === 'opfs') { const dir = await opfs(); if (dir) await dir.removeEntry(loc.ref).catch(() => {}); }
    if (loc.kind === 'idb') await db.blobs.delete(loc.ref);
    if (loc.kind === 'handle') await db.handles.delete(loc.ref);
  },

  async usage() {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota };
  },

  // Ask the browser not to evict our data (important on phones).
  async persist() {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || navigator.storage.persist();
  },
};
