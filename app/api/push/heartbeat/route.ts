import { NextResponse } from 'next/server';

import { fwDb } from '@/lib/db';
import { clientIp, jsonError, rateLimited } from '@/lib/http';
import { authorizedSub, isKnownPushEndpoint } from '@/lib/push';

export const dynamic = 'force-dynamic';

interface HeartbeatBody {
  endpoint?: string;
  /** Present after `pushsubscriptionchange`: the old endpoint, authorized with the old auth secret */
  oldEndpoint?: string;
  subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
}

/** Sent on every app open. Updates last_seen_at, and swaps the endpoint in place after a rotation. */
export async function POST(req: Request) {
  if (rateLimited(`hb:${clientIp(req)}`, 30, 60_000)) return jsonError(429, 'Too many requests.');
  const body = (await req.json().catch(() => null)) as HeartbeatBody | null;
  const auth = req.headers.get('authorization');
  const db = fwDb();
  const now = new Date().toISOString();

  if (body?.oldEndpoint && body.subscription?.endpoint) {
    const sub = authorizedSub(body.oldEndpoint, auth);
    const n = body.subscription;
    if (!sub || !n.keys?.p256dh || !n.keys.auth || !isKnownPushEndpoint(n.endpoint!)) return jsonError(401, 'Unknown subscription.');
    db.prepare('UPDATE subscriptions SET endpoint = ?, p256dh = ?, auth = ?, last_seen_at = ? WHERE id = ?')
      .run(n.endpoint, n.keys.p256dh, n.keys.auth, now, sub.id);
    return NextResponse.json({ ok: true, rotated: true });
  }

  const sub = authorizedSub(body?.endpoint, auth);
  if (!sub) return jsonError(404, 'Unknown subscription.');
  db.prepare('UPDATE subscriptions SET last_seen_at = ? WHERE id = ?').run(now, sub.id);
  return NextResponse.json({ ok: true });
}
