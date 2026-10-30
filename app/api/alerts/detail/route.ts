import { NextResponse } from 'next/server';

import { toWxAlert } from '@/lib/forecast';
import { jsonError } from '@/lib/http';
import { HttpError, nwsAlert } from '@/lib/sources';

export const dynamic = 'force-dynamic';

/** Full text of one alert, fetched when a warning or watch is tapped on the radar map */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^urn:oid:[\w.-]{1,120}$/.test(id)) return jsonError(400, 'Unknown alert id');
  try {
    const p = await nwsAlert(id);
    return NextResponse.json({ alert: { ...toWxAlert(p), areaDesc: p.areaDesc } }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return jsonError(404, 'This alert has ended.');
    return jsonError(502, "Couldn't reach NWS alerts. Try again in a minute.");
  }
}
