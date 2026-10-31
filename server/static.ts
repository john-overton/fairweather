/**
 * The Vite build (dist/web) under /fairweather, in production. In dev Vite serves the app itself and proxies only
 * /fairweather/api here, so with no dist/web every request below simply 404s.
 *
 * Cache policy: HTML and the service worker are always revalidated (an edge cache holding stale HTML would point
 * at hashed chunks a deploy removed); assets/ is content-hashed, so it's immutable; the rest (manifest, icons)
 * gets a day. The app uses hash routing, so there's no SPA fallback beyond the root.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { Context } from 'hono';

export const WEB_ROOT = path.resolve('dist/web');

export const hasWebBuild = () => fs.existsSync(path.join(WEB_ROOT, 'index.html'));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
};

function cacheControl(rel: string): string {
  if (rel === 'index.html' || rel === 'sw.js') return 'no-cache';
  if (rel.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=86400';
}

/** URL path below /fairweather/ → file in dist/web, or null for anything empty, hidden, or able to climb out */
function resolveFile(rel: string): string | null {
  let parts: string[];
  try {
    parts = rel.split('/').map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.some((p) => !p || p.startsWith('.') || /[\\/\0]/.test(p))) return null;
  const file = path.resolve(WEB_ROOT, ...parts);
  return file.startsWith(WEB_ROOT + path.sep) ? file : null;
}

/** Serve dist/web/<rel> (rel as it appears in the URL, still percent-encoded) with its cache policy, or 404 */
export async function serveWeb(c: Context, rel: string): Promise<Response> {
  const file = resolveFile(rel);
  const stat = file ? await fsp.stat(file).catch(() => null) : null;
  if (!file || !stat?.isFile()) return c.notFound();
  const name = path.relative(WEB_ROOT, file).split(path.sep).join('/');
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': cacheControl(name),
    ETag: etag,
    'Last-Modified': stat.mtime.toUTCString(),
    'X-Content-Type-Options': 'nosniff',
  };
  // Lets the worker at /fairweather/sw.js control /fairweather (no trailing slash) too
  if (name === 'sw.js') headers['Service-Worker-Allowed'] = '/fairweather';
  if (c.req.header('if-none-match')?.split(',').some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers });
  headers['Content-Length'] = String(stat.size);
  return new Response(c.req.method === 'HEAD' ? null : await fsp.readFile(file), { headers });
}
