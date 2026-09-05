// Per-site localStorage cache: remembers the highlights made here so they re-paint even when Diigo
// cannot be read (no helper channel), and keeps failed saves for retry. Always fails soft.
const PREFIX = 'dl2:';

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* quota or disabled */ }
  },
  remove(key) {
    try { localStorage.removeItem(PREFIX + key); } catch { /* ignore */ }
  },
};
