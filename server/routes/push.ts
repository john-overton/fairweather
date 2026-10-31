/**
 * /api/push/*: Web Push subscriptions. No accounts: a subscription's endpoint names it and
 * `Authorization: Bearer <its auth secret>` proves the caller owns it (lib/push.ts).
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { fwDb } from '@/lib/db';
import { clientIp, jsonError, rateLimited } from '@/lib/http';
import {
  authorizedSub, cleanLocations, cleanPrefs, deleteSub, isKnownPushEndpoint, isValidTz, saveLocations, savePrefs, sendPush,
  upsertSubscription, vapidPublicKey,
} from '@/lib/push';

export const push = new Hono();

interface PushSubscriptionJson { endpoint?: string; keys?: { p256dh?: string; auth?: string } }

/** Real bodies are a subscription plus up to 20 locations, well under this */
push.use(bodyLimit({ maxSize: 64 * 1024, onError: () => jsonError(413, 'Request too large.') }));

const readJson = <T>(req: Request) => req.json().catch(() => null) as Promise<T | null>;

push.get('/vapid-key', () => {
  const key = vapidPublicKey();
  if (!key) return jsonError(503, 'Notifications are not set up on this server yet.');
  return Response.json({ key });
});

/** Subscribe (upserts on endpoint). Body: subscription JSON, locations, prefs, IANA time zone. */
push.post('/subscribe', async (c) => {
  const req = c.req.raw;
  if (!vapidPublicKey()) return jsonError(503, 'Notifications are not set up on this server yet.');
  if (rateLimited(`sub:${clientIp(req)}`, 10, 60_000)) return jsonError(429, 'Too many requests. Try again in a minute.');
  const body = await readJson<{ subscription?: PushSubscriptionJson; locations?: unknown; prefs?: Record<string, unknown>; tz?: string }>(req);
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
  return Response.json({ ok: true });
});

/** Unsubscribe. Requires `endpoint` plus `Authorization: Bearer <auth secret>`. */
push.delete('/subscribe', async (c) => {
  const body = await readJson<{ endpoint?: string }>(c.req.raw);
  const sub = authorizedSub(body?.endpoint, c.req.header('authorization') ?? null);
  if (!sub) return jsonError(401, 'Unknown subscription.');
  deleteSub(sub.id);
  return Response.json({ ok: true });
});

/** Update locations and/or prefs. Requires `endpoint` plus `Authorization: Bearer <auth secret>`. */
push.put('/prefs', async (c) => {
  const req = c.req.raw;
  if (rateLimited(`prefs:${clientIp(req)}`, 10, 60_000)) return jsonError(429, 'Too many requests. Try again in a minute.');
  const body = await readJson<{ endpoint?: string; locations?: unknown; prefs?: Record<string, unknown>; tz?: string }>(req);
  const sub = authorizedSub(body?.endpoint, req.headers.get('authorization'));
  if (!sub) return jsonError(401, 'Unknown subscription.');
  if (body?.prefs) savePrefs(sub.id, cleanPrefs(body.prefs));
  if (body?.locations) {
    const locs = cleanLocations(body.locations);
    if (locs.length) await saveLocations(sub.id, locs);
  }
  if (isValidTz(body?.tz)) fwDb().prepare('UPDATE subscriptions SET tz = ? WHERE id = ?').run(body!.tz, sub.id);
  return Response.json({ ok: true });
});

/** Sent on every app open. Updates last_seen_at, and swaps the endpoint in place after a rotation. */
push.post('/heartbeat', async (c) => {
  const req = c.req.raw;
  if (rateLimited(`hb:${clientIp(req)}`, 30, 60_000)) return jsonError(429, 'Too many requests.');
  // oldEndpoint is present after `pushsubscriptionchange`: the old endpoint, authorized with the old auth secret
  const body = await readJson<{ endpoint?: string; oldEndpoint?: string; subscription?: PushSubscriptionJson }>(req);
  const auth = req.headers.get('authorization');
  const db = fwDb();
  const now = new Date().toISOString();

  if (body?.oldEndpoint && body.subscription?.endpoint) {
    const sub = authorizedSub(body.oldEndpoint, auth);
    const n = body.subscription;
    if (!sub || !n.keys?.p256dh || !n.keys.auth || !isKnownPushEndpoint(n.endpoint!)) return jsonError(401, 'Unknown subscription.');
    db.prepare('UPDATE subscriptions SET endpoint = ?, p256dh = ?, auth = ?, last_seen_at = ? WHERE id = ?')
      .run(n.endpoint, n.keys.p256dh, n.keys.auth, now, sub.id);
    return Response.json({ ok: true, rotated: true });
  }

  const sub = authorizedSub(body?.endpoint, auth);
  if (!sub) return jsonError(404, 'Unknown subscription.');
  db.prepare('UPDATE subscriptions SET last_seen_at = ? WHERE id = ?').run(now, sub.id);
  return Response.json({ ok: true });
});

/** Sends one test notification to the caller. Rate limited to 3 an hour. */
push.post('/test', async (c) => {
  const body = await readJson<{ endpoint?: string }>(c.req.raw);
  const sub = authorizedSub(body?.endpoint, c.req.header('authorization') ?? null);
  if (!sub) return jsonError(401, 'Unknown subscription. Turn notifications off and on again.');
  if (rateLimited(`test:${sub.id}`, 3, 3600_000)) return jsonError(429, 'Test limit reached (3 an hour). Try again later.');
  const status = await sendPush(sub, {
    title: 'Fairweather test',
    body: 'Notifications are working. Alerts, rain soon, and briefs will arrive like this.',
    url: '/fairweather#now',
    tag: 'test',
  }, { urgency: 'normal', ttl: 600 });
  if (status < 200 || status >= 300) return jsonError(502, `The push service answered ${status || 'with a network error'}. Try again shortly.`);
  return Response.json({ ok: true });
});
