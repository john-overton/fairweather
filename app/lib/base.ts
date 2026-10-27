/** basePath from next.config.ts. Next prefixes links and assets itself, but not fetch() or the service worker. */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '/fairweather';
export const api = (path: string) => `${BASE}/api/${path}`;
