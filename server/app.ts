/**
 * The Fairweather HTTP app, served under /fairweather (nginx proxies that prefix through unchanged).
 * API routes live in server/routes/*; everything else is the Vite build (server/static.ts).
 */
import { Hono } from 'hono';
import { compress } from 'hono/compress';

import { jsonError } from '@/lib/http';

import { push } from './routes/push';
import { radar } from './routes/radar';
import { weather } from './routes/weather';
import { serveWeb } from './static';

export const BASE_PATH = '/fairweather';

export const app = new Hono();

// gzip text responses (JSON, JS, CSS, SVG) over 1 KB; PNG tiles and fonts are left alone
app.use(compress());

app.onError((e, c) => {
  console.error(`[fairweather] ${c.req.method} ${c.req.path} failed`, e);
  return jsonError(500, 'Something went wrong on the server. Try again in a minute.');
});

app.notFound((c) => (c.req.path.startsWith(`${BASE_PATH}/api/`) ? jsonError(404, 'Not found') : c.text('Not found', 404)));

const api = new Hono();
api.route('/', weather);
api.route('/radar', radar);
api.route('/push', push);
app.route(`${BASE_PATH}/api`, api);

/* ------------------------------------------------------------------ */
/*  The built app                                                      */
/* ------------------------------------------------------------------ */

app.get(BASE_PATH, (c) => serveWeb(c, 'index.html'));
app.get(`${BASE_PATH}/`, (c) => serveWeb(c, 'index.html'));
app.get(`${BASE_PATH}/*`, (c) => {
  const rel = new URL(c.req.url).pathname.slice(BASE_PATH.length + 1);
  return rel.startsWith('api/') ? c.notFound() : serveWeb(c, rel);
});
