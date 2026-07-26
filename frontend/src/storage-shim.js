// Reproduz a API window.storage do Claude.ai usando localStorage do navegador,
// para rodar o app fora do Claude.ai sem alterar App.jsx.
const PREFIX = 'bancada_storage_data';

function readAll() {
  try { return JSON.parse(localStorage.getItem(PREFIX) || '{}'); } catch { return {}; }
}
function writeAll(obj) {
  localStorage.setItem(PREFIX, JSON.stringify(obj));
}
function scopedKey(key, shared) {
  return (shared ? 'shared:' : 'private:') + key;
}

window.storage = {
  async get(key, shared = false) {
    const all = readAll();
    const k = scopedKey(key, shared);
    if (!(k in all)) return null;
    return { key, value: all[k], shared };
  },
  async set(key, value, shared = false) {
    const all = readAll();
    all[scopedKey(key, shared)] = value;
    writeAll(all);
    return { key, value, shared };
  },
  async delete(key, shared = false) {
    const all = readAll();
    const k = scopedKey(key, shared);
    const existed = k in all;
    delete all[k];
    writeAll(all);
    return { key, deleted: existed, shared };
  },
  async list(prefix = '', shared = false) {
    const all = readAll();
    const p = scopedKey(prefix, shared);
    const scopePrefix = shared ? 'shared:' : 'private:';
    const keys = Object.keys(all).filter((k) => k.startsWith(p)).map((k) => k.slice(scopePrefix.length));
    return { keys, prefix, shared };
  },
};
