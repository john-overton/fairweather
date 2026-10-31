/**
 * Fairweather server: the Hono app (API + built frontend) on FAIRWEATHER_HOST:FAIRWEATHER_PORT, plus the scheduled
 * jobs in-process. Run from the repo root (`npm start`, or `npm run dev` for tsx watch + Vite).
 */
import './env';

import { serve } from '@hono/node-server';

import { config } from '@/lib/config';
import { closeDb } from '@/lib/db';
import { stopMrmsWorker } from '@/lib/mrms';

import { app, BASE_PATH } from './app';
import { startJobs, stopJobs } from './jobs';
import { hasWebBuild, WEB_ROOT } from './static';

// First, so a bad schedule fails the start before the port is taken
try {
  startJobs();
} catch (e) {
  console.error(`[fairweather] ${(e as Error).message}`);
  process.exit(1);
}

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  const host = info.family === 'IPv6' ? `[${info.address}]` : info.address;
  console.log(`[fairweather] listening on http://${host}:${info.port}${BASE_PATH}`
    + (hasWebBuild() ? ` (serving ${WEB_ROOT})` : ' (API only: no dist/web build)'));
});

server.on('error', (e) => {
  console.error('[fairweather] server failed', e);
  process.exit(1);
});

/* ------------------------------------------------------------------ */
/*  Shutdown: stop ticking, drain HTTP and running jobs, close SQLite  */
/* ------------------------------------------------------------------ */

let stopping = false;

async function shutdown(signal: string) {
  if (stopping) {
    console.log(`[fairweather] ${signal} again, exiting now`);
    process.exit(1);
  }
  stopping = true;
  console.log(`[fairweather] ${signal}, shutting down`);
  const closed = new Promise<void>((resolve) => server.close(() => resolve()));
  if ('closeIdleConnections' in server) server.closeIdleConnections();
  // Keep-alive sockets with a request in flight finish it; anything still open after 10 s is cut
  const cut = setTimeout(() => 'closeAllConnections' in server && server.closeAllConnections(), 10_000);
  await Promise.all([stopJobs(), closed]);
  clearTimeout(cut);
  await stopMrmsWorker().catch(() => {});
  closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
