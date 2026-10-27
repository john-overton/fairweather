import { NextResponse } from 'next/server';

import { runAlerts, runCleanup, runRadar, runRainAndBrief } from '@/lib/cron';
import { jsonError } from '@/lib/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const JOBS: Record<string, () => unknown> = {
  alerts: runAlerts,
  rain: runRainAndBrief,
  cleanup: runCleanup,
  radar: runRadar,
};

/**
 * Triggered by the server crontab (scripts/cron.sh).
 * Requires `Authorization: Bearer $FAIRWEATHER_CRON_SECRET`.
 */
export async function POST(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const secret = process.env.FAIRWEATHER_CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return jsonError(401, 'Unauthorized');
  const { job } = await params;
  const run = JOBS[job];
  if (!run) return jsonError(404, `Unknown job: ${job}`);
  const started = Date.now();
  try {
    const result = await run();
    return NextResponse.json({ job, ms: Date.now() - started, result });
  } catch (e) {
    console.error(`[fairweather] cron ${job} failed`, e);
    return jsonError(500, `${job} failed: ${(e as Error).message}`);
  }
}
