/**
 * Fairweather scheduled jobs. Triggered by the server's crontab via
 * scripts/cron.sh → POST /fairweather/api/cron/{job}.
 *
 *   alerts   every 2 min   NWS alerts for every saved zone → push
 *   rain     every 15 min  "Rain soon" + morning brief
 *   cleanup  daily 3:17    prune dead/abandoned subscriptions and old rows
 *   radar    every 5 min   prewarm the radar tile cache, prune old frames
 */
import { fwDb, type SubLocationRow, type SubPrefsRow, type SubRow } from './db';
import { alertLevel, buildForecast } from './forecast';
import { deliverOnce, fanOut, inQuietHours, localMinutes, toMin, type PushPayload } from './push';
import { prewarmRadar, pruneRadarTiles } from './radar';
import { nwsAlertsZones, omMinutely, type NwsAlertProps } from './sources';

const LEVEL_RANK: Record<string, number> = { statement: 0, advisory: 1, watch: 2, warning: 3 };
const HOUR = 3600_000;

interface Target { sub: SubRow; prefs: SubPrefsRow; loc: SubLocationRow }

function targets(where = '1 = 1'): Target[] {
  const rows = fwDb().prepare(`
    SELECT s.*, p.alert_min, p.rain_soon, p.brief_time, p.quiet_start, p.quiet_end,
           l.id AS loc_id, l.client_id, l.name, l.lat, l.lon, l.is_primary, l.zone_ids
    FROM subscriptions s
    JOIN sub_prefs p ON p.sub_id = s.id
    JOIN sub_locations l ON l.sub_id = s.id
    WHERE ${where}
  `).all() as Record<string, unknown>[];
  return rows.map((r) => ({
    sub: r as unknown as SubRow,
    prefs: { sub_id: r.id as number, alert_min: r.alert_min as string, rain_soon: r.rain_soon as number, brief_time: r.brief_time as string | null, quiet_start: r.quiet_start as string, quiet_end: r.quiet_end as string },
    loc: { id: r.loc_id as number, sub_id: r.id as number, client_id: r.client_id as string, name: r.name as string, lat: r.lat as number, lon: r.lon as number, is_primary: r.is_primary as number, zone_ids: r.zone_ids as string },
  }));
}

const shortName = (name: string) => name.replace(/,\s*[A-Z]{2}$/, '');

/* ------------------------------------------------------------------ */
/*  Alerts                                                             */
/* ------------------------------------------------------------------ */

export async function runAlerts() {
  const db = fwDb();
  const all = targets();
  const zones = [...new Set(all.flatMap((t) => JSON.parse(t.loc.zone_ids) as string[]))];
  const alerts: NwsAlertProps[] = [];
  for (let i = 0; i < zones.length; i += 25) {
    alerts.push(...(await nwsAlertsZones(zones.slice(i, i + 25))));
  }

  const seen = db.prepare(`
    INSERT INTO alerts_seen (alert_id, zone_ids, event, severity, sent_version, expires_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(alert_id) DO UPDATE SET sent_version = excluded.sent_version, expires_at = excluded.expires_at, zone_ids = excluded.zone_ids
  `);
  const wasDelivered = db.prepare("SELECT 1 FROM deliveries WHERE sub_id = ? AND kind = 'alert' AND ref LIKE ? LIMIT 1");

  const jobs: (() => Promise<unknown>)[] = [];
  let considered = 0;
  for (const a of alerts) {
    const ugc = a.geocode?.UGC ?? [];
    seen.run(a.id, JSON.stringify(ugc), a.event, a.severity, a.sent, a.expires ?? a.ends ?? a.sent);
    const level = alertLevel(a.event);
    const isCancel = a.messageType === 'Cancel';
    const rootId = a.references?.[0]?.identifier ?? a.id;
    const expiresMs = Date.parse(a.ends ?? a.expires ?? '') || Date.now() + 6 * HOUR;
    const ttl = Math.max(60, Math.min(24 * 3600, Math.round((expiresMs - Date.now()) / 1000)));

    // One notification per subscription per alert, even if several saved locations match
    const bySub = new Map<number, Target>();
    for (const t of all) {
      if (bySub.has(t.sub.id)) continue;
      const tz = JSON.parse(t.loc.zone_ids) as string[];
      if (tz.some((z) => ugc.includes(z))) bySub.set(t.sub.id, t);
    }
    for (const t of bySub.values()) {
      if (LEVEL_RANK[level] < LEVEL_RANK[t.prefs.alert_min] || level === 'statement') continue;
      // Quiet hours hold everything except Extreme/Severe warnings; held alerts go out after quiet hours
      const urgent = level === 'warning' && (a.severity === 'Extreme' || a.severity === 'Severe');
      if (!urgent && inQuietHours(t.sub.tz, t.prefs.quiet_start, t.prefs.quiet_end)) continue;
      // Only send a cancellation to someone who got the original
      if (isCancel && !a.references?.some((r) => wasDelivered.get(t.sub.id, `${r.identifier}|%`))) continue;
      considered++;
      const payload: PushPayload = {
        title: `${isCancel ? 'Cancelled: ' : ''}${a.event} · ${shortName(t.loc.name)}`,
        body: a.headline ?? a.description.split('\n')[0],
        url: '/fairweather#now',
        tag: rootId,
      };
      jobs.push(() => deliverOnce(t.sub, 'alert', `${a.id}|${a.sent}`, payload, {
        urgency: level === 'warning' ? 'high' : 'normal',
        ttl,
      }));
    }
  }
  await fanOut(jobs, (j) => j());
  return { zones: zones.length, alerts: alerts.length, considered };
}

/* ------------------------------------------------------------------ */
/*  Rain soon + morning brief                                          */
/* ------------------------------------------------------------------ */

export async function runRainAndBrief() {
  const db = fwDb();
  const primaries = targets('l.is_primary = 1');
  const recentRain = db.prepare("SELECT 1 FROM deliveries WHERE sub_id = ? AND kind = 'rain' AND sent_at > ? LIMIT 1");

  // Rain soon: dedupe locations by lat/lon rounded to 2 decimals
  const byLoc = new Map<string, Target[]>();
  for (const t of primaries) {
    if (!t.prefs.rain_soon) continue;
    const k = `${t.loc.lat.toFixed(2)},${t.loc.lon.toFixed(2)}`;
    byLoc.set(k, [...(byLoc.get(k) ?? []), t]);
  }
  const jobs: (() => Promise<unknown>)[] = [];
  let rainLocs = 0;
  for (const [, list] of byLoc) {
    let q;
    try {
      q = (await omMinutely(list[0].loc.lat, list[0].loc.lon)).minutely_15;
    } catch {
      continue;
    }
    const nowS = Date.now() / 1000;
    const past = q.time.map((t, i) => [t, q.precipitation[i] ?? 0] as const).filter(([t]) => t < nowS - 600);
    const next = q.time.map((t, i) => [t, q.precipitation[i] ?? 0] as const).filter(([t]) => t >= nowS - 600);
    const pastSum = past.slice(-4).reduce((a, [, v]) => a + v, 0);
    const nextList = next.slice(0, 4);
    const nextSum = nextList.reduce((a, [, v]) => a + v, 0);
    if (pastSum >= 0.01 || nextSum < 0.01) continue;
    rainLocs++;
    const startIdx = nextList.findIndex(([, v]) => v > 0);
    const mins = Math.max(15, Math.round((nextList[Math.max(0, startIdx)][0] - nowS) / 60 / 5) * 5);
    const hourRef = new Date(Math.floor(Date.now() / HOUR) * HOUR).toISOString();
    for (const t of list) {
      if (inQuietHours(t.sub.tz, t.prefs.quiet_start, t.prefs.quiet_end)) continue;
      if (recentRain.get(t.sub.id, new Date(Date.now() - 3 * HOUR).toISOString())) continue;
      jobs.push(() => deliverOnce(t.sub, 'rain', `${t.loc.client_id}|${hourRef}`, {
        title: `Rain soon · ${shortName(t.loc.name)}`,
        body: `Rain is expected to start in about ${mins} minutes, around ${nextSum.toFixed(2)} in over the next hour.`,
        url: '/fairweather#radar',
        tag: `rain-${t.loc.client_id}`,
      }, { urgency: 'normal', ttl: 1800 }));
    }
  }

  // Morning brief: within 90 minutes after the chosen local time, once per local date
  let briefs = 0;
  for (const t of primaries) {
    if (!t.prefs.brief_time) continue;
    const m = localMinutes(t.sub.tz);
    const start = toMin(t.prefs.brief_time);
    if (m < start || m >= start + 90) continue;
    if (inQuietHours(t.sub.tz, t.prefs.quiet_start, t.prefs.quiet_end)) continue;
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: t.sub.tz }).format(new Date());
    briefs++;
    jobs.push(async () => {
      const already = db.prepare("SELECT 1 FROM deliveries WHERE sub_id = ? AND kind = 'brief' AND ref = ?").get(t.sub.id, localDate);
      if (already) return;
      const f = await buildForecast(Number(t.loc.lat.toFixed(2)), Number(t.loc.lon.toFixed(2)));
      const pop = Math.max(0, ...f.hourly.slice(0, 16).map((h) => h.pop));
      const bits = [`High ${f.now.high ?? '?'}°, low ${f.now.low ?? '?'}°.`, `Rain chance ${pop}%.`];
      if (f.alerts.length) bits.push(`${f.alerts.map((a) => a.event).join(', ')} in effect.`);
      await deliverOnce(t.sub, 'brief', localDate, {
        title: `Morning brief · ${shortName(t.loc.name)}`,
        body: bits.join(' '),
        url: '/fairweather#now',
        tag: 'brief',
      }, { urgency: 'low', ttl: 7200 });
    });
  }

  await fanOut(jobs, (j) => j());
  return { rainLocations: rainLocs, briefs };
}

/* ------------------------------------------------------------------ */
/*  Cleanup                                                            */
/* ------------------------------------------------------------------ */

export function runCleanup() {
  const db = fwDb();
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const DAY = 24 * HOUR;
  const delSubs = (ids: { id: number }[]) => {
    const stmt = db.prepare('DELETE FROM subscriptions WHERE id = ?');
    db.transaction(() => {
      for (const { id } of ids) {
        db.prepare('DELETE FROM deliveries WHERE sub_id = ?').run(id);
        db.prepare('DELETE FROM sub_locations WHERE sub_id = ?').run(id);
        db.prepare('DELETE FROM sub_prefs WHERE sub_id = ?').run(id);
        stmt.run(id);
      }
    })();
    return ids.length;
  };

  const dead = delSubs(db.prepare('SELECT id FROM subscriptions WHERE fail_count >= 10 AND first_fail_at < ?').all(iso(7 * DAY)) as { id: number }[]);
  const abandoned = delSubs(db.prepare(
    'SELECT id FROM subscriptions WHERE last_seen_at < ? AND (last_success_at IS NULL OR last_success_at < ?)',
  ).all(iso(120 * DAY), iso(30 * DAY)) as { id: number }[]);
  const alertsPruned = db.prepare('DELETE FROM alerts_seen WHERE expires_at < ?').run(iso(7 * DAY)).changes;
  const deliveriesPruned = db.prepare('DELETE FROM deliveries WHERE sent_at < ?').run(iso(30 * DAY)).changes;

  const counts = { dead, abandoned, alertsPruned, deliveriesPruned };
  console.log('[fairweather] cleanup', counts);
  return counts;
}

/* ------------------------------------------------------------------ */
/*  Radar tile cache                                                   */
/* ------------------------------------------------------------------ */

const DEFAULT_POINT = { lat: 39.0997, lon: -94.5786 }; // Kansas City, the app's default location

export async function runRadar() {
  // Kansas City plus every subscriber's saved places (rounded to ~10 km, capped) so their first look is instant
  const rows = fwDb().prepare('SELECT DISTINCT ROUND(lat, 1) AS lat, ROUND(lon, 1) AS lon FROM sub_locations LIMIT 20').all() as { lat: number; lon: number }[];
  const points = [DEFAULT_POINT, ...rows.filter((r) => Math.abs(r.lat - DEFAULT_POINT.lat) > 0.5 || Math.abs(r.lon - DEFAULT_POINT.lon) > 0.5)];
  const warm = await prewarmRadar(points);
  const prune = await pruneRadarTiles();
  return { ...warm, ...prune };
}
