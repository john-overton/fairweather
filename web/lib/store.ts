/** localStorage wrapper. Every read and write is wrapped so the app works with storage blocked. */
const VERSION = 1;

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* storage blocked or full */ }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch { /* ignore */ }
  },
};

/** Drop stored data from older schema versions. */
export function migrateStore() {
  if (store.get<number>('wx.v', 0) === VERSION) return;
  store.set('wx.v', VERSION);
}
