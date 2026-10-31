/** /api/radar/manifest, /api/radar/alerts, /api/radar/tile/{iem-layer}/{z}/{x}/{y}.png */
import { Hono } from 'hono';

import { jsonError } from '@/lib/http';
import { radarManifest, radarTile, validTile } from '@/lib/radar';
import { radarAlerts } from '@/lib/wwa';

export const radar = new Hono();

radar.get('/manifest', async () => {
  try {
    return Response.json(await radarManifest(), { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch {
    return jsonError(502, "Couldn't reach the radar archive. Trying again in a minute.");
  }
});

/** Warning and watch outlines for the radar map (no text; see /api/alerts/detail) */
radar.get('/alerts', async () => {
  try {
    return Response.json(await radarAlerts(), { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (e) {
    console.error('[fairweather] radar alerts failed', e);
    return jsonError(502, "Couldn't reach NWS alerts. Trying again in 2 minutes.");
  }
});

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });

/** Cached on disk (see lib/radar.ts). Segments come from the raw path, so the layer is decoded exactly once. */
radar.get('/tile/*', async (c) => {
  const pathname = new URL(c.req.url).pathname;
  const parts = pathname.slice(pathname.indexOf('/tile/') + 6).split('/');
  const [layer, z, x, file] = parts;
  let name: string;
  try {
    name = decodeURIComponent(layer ?? '');
  } catch {
    return notFound();
  }
  const t = { layer: name, z: Number(z), x: Number(x), y: Number(file?.replace(/\.png$/, '')) };
  if (parts.length !== 4 || !file?.endsWith('.png') || !validTile(t)) return notFound();
  const tile = await radarTile(t);
  if (!tile) return new Response('Radar tile unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  return new Response(new Uint8Array(tile.png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': tile.final ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
    },
  });
});
