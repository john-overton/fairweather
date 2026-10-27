import { NextResponse } from 'next/server';

import { clientIp, jsonError, rateLimited } from '@/lib/http';
import { authorizedSub, cleanLocations, cleanPrefs, isValidTz, saveLocations, savePrefs } from '@/lib/push';
import { fwDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Update locations and/or prefs. Requires `endpoint` plus `Authorization: Bearer <auth secret>`. */
export async function PUT(req: Request) {
  if (rateLimited(`prefs:${clientIp(req)}`, 10, 60_000)) return jsonError(429, 'Too many requests. Try again in a minute.');
  const body = (await req.json().catch(() => null)) as { endpoint?: string; locations?: unknown; prefs?: Record<string, unknown>; tz?: string } | null;
  const sub = authorizedSub(body?.endpoint, req.headers.get('authorization'));
  if (!sub) return jsonError(401, 'Unknown subscription.');
  if (body?.prefs) savePrefs(sub.id, cleanPrefs(body.prefs));
  if (body?.locations) {
    const locs = cleanLocations(body.locations);
    if (locs.length) await saveLocations(sub.id, locs);
  }
  if (isValidTz(body?.tz)) fwDb().prepare('UPDATE subscriptions SET tz = ? WHERE id = ?').run(body!.tz, sub.id);
  return NextResponse.json({ ok: true });
}
