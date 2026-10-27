import { NextResponse } from 'next/server';

import { jsonError } from '@/lib/http';
import { radarManifest } from '@/lib/radar';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await radarManifest(), { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch {
    return jsonError(502, "Couldn't reach the radar archive. Trying again in a minute.");
  }
}
