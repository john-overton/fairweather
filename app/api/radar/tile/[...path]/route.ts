import { radarTile, validTile } from '@/lib/radar';

export const dynamic = 'force-dynamic';

/** GET /fairweather/api/radar/tile/{iem-layer}/{z}/{x}/{y}.png, cached on disk (see lib/radar.ts). */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [layer, z, x, file] = path ?? [];
  const t = { layer: decodeURIComponent(layer ?? ''), z: Number(z), x: Number(x), y: Number(file?.replace(/\.png$/, '')) };
  if (path?.length !== 4 || !file?.endsWith('.png') || !validTile(t)) {
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  }
  const tile = await radarTile(t);
  if (!tile) return new Response('Radar tile unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  return new Response(new Uint8Array(tile.png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': tile.final ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
    },
  });
}
