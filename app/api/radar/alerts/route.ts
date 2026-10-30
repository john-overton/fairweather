import { NextResponse } from 'next/server';

import { jsonError } from '@/lib/http';
import { radarAlerts } from '@/lib/wwa';

export const dynamic = 'force-dynamic';

/** Warning and watch outlines for the radar map (no text; see /api/alerts/detail) */
export async function GET() {
  try {
    return NextResponse.json(await radarAlerts(), { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (e) {
    console.error('[fairweather] radar alerts failed', e);
    return jsonError(502, "Couldn't reach NWS alerts. Trying again in 2 minutes.");
  }
}
