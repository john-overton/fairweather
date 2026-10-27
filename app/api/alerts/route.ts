import { NextResponse } from 'next/server';

import { toWxAlert } from '@/lib/forecast';
import { jsonError, parseLatLon } from '@/lib/http';
import { nwsAlertsPoint } from '@/lib/sources';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const ll = parseLatLon(new URL(req.url));
  if (!ll) return jsonError(400, 'Use decimal degrees, like lat=39.0997&lon=-94.5786');
  try {
    const alerts = (await nwsAlertsPoint(ll.lat, ll.lon)).map(toWxAlert).filter((a) => a.messageType !== 'Cancel');
    return NextResponse.json({ alerts }, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch {
    return jsonError(502, "Couldn't reach NWS alerts. Trying again in 2 minutes.");
  }
}
