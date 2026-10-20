// Tiny event bus so modules can talk without importing each other.
// Common events:
//   'item:open'     { item }            -> owning module opens it
//   'item:changed'  { id }              -> views refresh
//   'module:toggled'{ id, enabled }
//   'storage:mode'  { mode }
//   'update:available' { list }
const listeners = new Map();

export const bus = {
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => listeners.get(event).delete(fn);
  },
  emit(event, payload) {
    for (const fn of listeners.get(event) || []) {
      try { fn(payload); } catch (e) { console.error('[bus]', event, e); }
    }
  },
};
