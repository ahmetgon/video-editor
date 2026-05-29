const listeners = new Map();

export function emitProgress(projectId, data) {
  const cbs = listeners.get(projectId);
  if (cbs) cbs.forEach((cb) => cb(data));
}

export function onProgress(projectId, cb) {
  if (!listeners.has(projectId)) listeners.set(projectId, new Set());
  listeners.get(projectId).add(cb);
  return () => {
    const s = listeners.get(projectId);
    if (s) { s.delete(cb); if (s.size === 0) listeners.delete(projectId); }
  };
}
