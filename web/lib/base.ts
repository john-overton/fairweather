/** Vite's `base` (vite.config.ts) without the trailing slash. Vite prefixes its own asset URLs, but not fetch() or the service worker. */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const api = (path: string) => `${BASE}/api/${path}`;
