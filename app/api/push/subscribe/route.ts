import { NextResponse } from 'next/server';

import { clientIp, jsonError, rateLimited } from '@/lib/http';
import {
  authorizedSub, cleanLocations, cleanPrefs, deleteSub, isKnownPushEndpoint, isValidTz, saveLocations, savePrefs,
  upsertSubscription, vapidPublicKey,
} from '@/lib/push';

export const dynamic = 'force-dynamic';

interface SubscribeBody {
  subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  locations?: unknown;
  prefs?: Record<string, unknown>;
  tz?: string;
}

/** Subscribe (upserts on endpoint). Body: subscription JSON, locations, prefs, IANA time zone. */
export async function POST(req: Request) {
  if (!vapidPublicKey()) return jsonError(503, 'Notifications are not set up on this server yet.');
  if (rateLimited(`sub:${clientIp(req)}`, 10, 60_000)) return jsonError(429, 'Too many requests. Try again in a minute.');
  const body = (await req.json().catch(() => null)) as SubscribeBody | null;
  const s = body?.subscription;
  if (!s?.endpoint || !s.keys?.p256dh || !s.keys.auth) return jsonError(400, 'Missing push subscription.');
  if (!isKnownPushEndpoint(s.endpoint)) return jsonError(400, 'Unknown push service.');
  if (!isValidTz(body?.tz)) return jsonError(400, 'Missing time zone.');
  const locations = cleanLocations(body?.locations);
  if (!locations.length) return jsonError(400, 'Save at least one location first.');

  const id = upsertSubscription({
    endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, tz: body!.tz!,
    ua: req.headers.get('user-agent')?.slice(0, 200) ?? null,
  });
  savePrefs(id, cleanPrefs(body?.prefs));
  await saveLocations(id, locations);
  return NextResponse.json({ ok: true });
}

/** Unsubscribe. Requires `endpoint` plus `Authorization: Bearer <auth secret>`. */
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  const sub = authorizedSub(body?.endpoint, req.headers.get('authorization'));
  if (!sub) return jsonError(401, 'Unknown subscription.');
  deleteSub(sub.id);
  return NextResponse.json({ ok: true });
}
