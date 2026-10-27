/**
 * Web Push for Fairweather. No accounts: each browser's push subscription is its
 * identity, and its `auth` secret is the credential for changing it.
 * VAPID keys come from .env.local (FAIRWEATHER_VAPID_*).
 */
import webpush, { type WebPushError } from 'web-push';

import { fwDb, type SubRow } from './db';
import { nwsPoint } from './sources';
import type { AlertMin, PushPrefs, SavedLocation } from './types';

let configured = false;

export function vapidPublicKey(): string | null {
  return process.env.FAIRWEATHER_VAPID_PUBLIC_KEY || null;
}

function ensureVapid() {
  if (configured) return;
  const pub = process.env.FAIRWEATHER_VAPID_PUBLIC_KEY;
  const priv = process.env.FAIRWEATHER_VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error('Push is not configured: set FAIRWEATHER_VAPID_PUBLIC_KEY and FAIRWEATHER_VAPID_PRIVATE_KEY');
  webpush.setVapidDetails(process.env.FAIRWEATHER_VAPID_SUBJECT || 'mailto:john@jroverton.com', pub, priv);
  configured = true;
}

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^jmt17\.google\.com$/, /\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /\.notify\.windows\.com$/];

export function isKnownPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALERT_MINS: AlertMin[] = ['advisory', 'watch', 'warning'];

export function cleanPrefs(p: Partial<PushPrefs> | undefined): PushPrefs {
  return {
    alertMin: ALERT_MINS.includes(p?.alertMin as AlertMin) ? (p!.alertMin as AlertMin) : 'watch',
    rainSoon: p?.rainSoon ?? true,
    briefTime: p?.briefTime && HHMM.test(p.briefTime) ? p.briefTime : null,
    quietStart: p?.quietStart && HHMM.test(p.quietStart) ? p.quietStart : '22:00',
    quietEnd: p?.quietEnd && HHMM.test(p.quietEnd) ? p.quietEnd : '06:00',
  };
}

export function cleanLocations(list: unknown): (SavedLocation & { primary: boolean })[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).flatMap((l, i) => {
    const lat = Number(l?.lat), lon = Number(l?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];
    return [{
      id: String(l?.id ?? i).slice(0, 64),
      name: String(l?.name ?? 'Location').slice(0, 80),
      lat, lon,
      primary: !!l?.primary,
    }];
  });
}

export function isValidTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Subscriptions                                                      */
/* ------------------------------------------------------------------ */

export function findSub(endpoint: string): SubRow | undefined {
  return fwDb().prepare('SELECT * FROM subscriptions WHERE endpoint = ?').get(endpoint) as SubRow | undefined;
}

/** Returns the sub if `Authorization: Bearer <auth>` matches the stored auth secret. */
export function authorizedSub(endpoint: string | undefined, authHeader: string | null): SubRow | null {
  if (!endpoint) return null;
  const sub = findSub(endpoint);
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  return sub && token && token === sub.auth ? sub : null;
}

async function zonesFor(lat: number, lon: number): Promise<string[]> {
  try {
    return (await nwsPoint(lat, lon)).zones;
  } catch {
    return [];
  }
}

export async function saveLocations(subId: number, locations: (SavedLocation & { primary: boolean })[]) {
  const withZones = await Promise.all(locations.map(async (l) => ({ ...l, zones: await zonesFor(l.lat, l.lon) })));
  if (withZones.length && !withZones.some((l) => l.primary)) withZones[0].primary = true;
  const db = fwDb();
  const ins = db.prepare('INSERT INTO sub_locations (sub_id, client_id, name, lat, lon, is_primary, zone_ids) VALUES (?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    db.prepare('DELETE FROM sub_locations WHERE sub_id = ?').run(subId);
    for (const l of withZones) ins.run(subId, l.id, l.name, l.lat, l.lon, l.primary ? 1 : 0, JSON.stringify(l.zones));
  })();
}

export function savePrefs(subId: number, p: PushPrefs) {
  fwDb().prepare(`
    INSERT INTO sub_prefs (sub_id, alert_min, rain_soon, brief_time, quiet_start, quiet_end)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(sub_id) DO UPDATE SET alert_min = excluded.alert_min, rain_soon = excluded.rain_soon,
      brief_time = excluded.brief_time, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end
  `).run(subId, p.alertMin, p.rainSoon ? 1 : 0, p.briefTime, p.quietStart, p.quietEnd);
}

export function upsertSubscription(s: { endpoint: string; p256dh: string; auth: string; tz: string; ua: string | null }): number {
  const now = new Date().toISOString();
  const row = fwDb().prepare(`
    INSERT INTO subscriptions (endpoint, p256dh, auth, tz, user_agent, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz,
      user_agent = excluded.user_agent, last_seen_at = excluded.last_seen_at
    RETURNING id
  `).get(s.endpoint, s.p256dh, s.auth, s.tz, s.ua, now, now) as { id: number };
  return row.id;
}

export function deleteSub(id: number) {
  const db = fwDb();
  // Foreign keys are on, but delete children explicitly in case the pragma was off for this connection
  db.transaction(() => {
    db.prepare('DELETE FROM deliveries WHERE sub_id = ?').run(id);
    db.prepare('DELETE FROM sub_locations WHERE sub_id = ?').run(id);
    db.prepare('DELETE FROM sub_prefs WHERE sub_id = ?').run(id);
    db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
  })();
}

/* ------------------------------------------------------------------ */
/*  Sending                                                            */
/* ------------------------------------------------------------------ */

export interface PushPayload {
  title: string;
  body: string;
  /** Page to open, e.g. `/fairweather#radar` */
  url: string;
  tag?: string;
}

export interface SendOpts {
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
  ttl?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function encode(p: PushPayload): string {
  const body = p.body.length > 400 ? `${p.body.slice(0, 397)}...` : p.body;
  return JSON.stringify({ ...p, body }).slice(0, 3000);
}

/** Send one notification and apply the cleanup rules. Returns the push service status (0 = network error). */
export async function sendPush(sub: SubRow, payload: PushPayload, opts: SendOpts = {}): Promise<number> {
  ensureVapid();
  const db = fwDb();
  const data = encode(payload);
  const send = () => webpush.sendNotification(
    { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
    data,
    { TTL: opts.ttl ?? 3600, urgency: opts.urgency ?? 'normal', topic: payload.tag?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined },
  );

  let status = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      status = (await send()).statusCode;
    } catch (e) {
      const err = e as WebPushError;
      status = err.statusCode ?? 0;
      if ((status === 429 || status >= 500) && attempt === 0) {
        const ra = Number(err.headers?.['retry-after']);
        await sleep(Math.min(60, Number.isFinite(ra) && ra > 0 ? ra : 5) * 1000);
        continue;
      }
    }
    break;
  }

  const now = new Date().toISOString();
  if (status >= 200 && status < 300) {
    db.prepare('UPDATE subscriptions SET last_success_at = ?, fail_count = 0, first_fail_at = NULL WHERE id = ?').run(now, sub.id);
  } else if (status === 404 || status === 410) {
    deleteSub(sub.id);
  } else if (status === 400 || status === 413) {
    console.warn(`[fairweather] push rejected payload (${status}), ${data.length} bytes, tag=${payload.tag ?? ''}`);
  } else {
    db.prepare('UPDATE subscriptions SET fail_count = fail_count + 1, first_fail_at = COALESCE(first_fail_at, ?) WHERE id = ?').run(now, sub.id);
  }
  return status;
}

/**
 * Dedupe guard: insert the delivery row first, send only if the insert succeeded.
 * Returns the status, or null if this (sub, kind, ref) was already delivered.
 */
export async function deliverOnce(sub: SubRow, kind: string, ref: string, payload: PushPayload, opts?: SendOpts): Promise<number | null> {
  const db = fwDb();
  const ins = db.prepare('INSERT OR IGNORE INTO deliveries (sub_id, kind, ref, sent_at, status) VALUES (?, ?, ?, ?, 0)')
    .run(sub.id, kind, ref, new Date().toISOString());
  if (ins.changes === 0) return null;
  const status = await sendPush(sub, payload, opts);
  if (status !== 404 && status !== 410) {
    db.prepare('UPDATE deliveries SET status = ? WHERE id = ?').run(status, ins.lastInsertRowid);
  }
  return status;
}

/** Run sends in batches of 50 so one slow push service does not stall the rest. */
export async function fanOut<T>(items: T[], fn: (t: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += 50) {
    await Promise.allSettled(items.slice(i, i + 50).map(fn));
  }
}

/* ------------------------------------------------------------------ */
/*  Quiet hours                                                        */
/* ------------------------------------------------------------------ */

export function localMinutes(tz: string, at = new Date()): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function inQuietHours(tz: string, start: string, end: string, at = new Date()): boolean {
  const m = localMinutes(tz, at), s = toMin(start), e = toMin(end);
  if (s === e) return false;
  return s < e ? m >= s && m < e : m >= s || m < e;
}

export { toMin };
