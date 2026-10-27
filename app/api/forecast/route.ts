import { NextResponse } from 'next/server';

import { buildForecast } from '@/lib/forecast';
import { jsonError, parseLatLon } from '@/lib/http';
import { cached } from '@/lib/sources';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ll = parseLatLon(new URL(req.url));
  if (!ll) return jsonError(400, 'Use decimal degrees, like lat=39.0997&lon=-94.5786');
  try {
    const data = await cached(`forecast:${ll.lat},${ll.lon}`, 10 * 60_000, () => buildForecast(ll.lat, ll.lon));
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=600' } });
  } catch (e) {
    console.error('[fairweather] forecast failed', e);
    return jsonError(502, `Couldn't load the forecast (${(e as Error).message}). Showing saved data if available.`);
  }
}
