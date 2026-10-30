/**
 * Warnings and watches for the radar map: outlines only, nationwide. The text stays on NWS until
 * someone taps a shape (app/api/alerts/detail).
 *
 * Storm-based warnings (tornado, severe thunderstorm, flash flood, ...) carry their own polygon.
 * Everything else is drawn from its forecast zones and counties; those outlines rarely change, so
 * they're simplified once and kept on disk. Marine-only alerts (Gale, Storm Warnings) are left off.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import type * as GeoJSON from 'geojson';

import { alertLevel } from './forecast';
import { cached, nwsAlertsActive, nwsZoneGeometry, type NwsAlertFeature } from './sources';
import type { WwaProps } from './types';

const ZONE_DIR = process.env.FAIRWEATHER_ZONE_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'data', 'zones');
/** Marine zone UGC prefixes (coastal waters, Great Lakes, offshore) */
const MARINE = /^(AM|AN|GM|LC|LE|LH|LM|LO|LS|PH|PK|PM|PS|PZ|SL)Z\d{3}$/;
/** Zone outlines are simplified to about 1 km (fine at radar zooms); storm-based polygons are already simple */
const ZONE_TOLERANCE = 0.01;

/** NWS hazard-map colors, a few brightened so they read on the night basemap */
const COLORS: Record<string, string> = {
  'Tornado Warning': '#ff2a2a',
  'Extreme Wind Warning': '#ff8c00',
  'Severe Thunderstorm Warning': '#ffa500',
  'Special Marine Warning': '#ffa500',
  'Flash Flood Warning': '#e0115f',
  'Flood Warning': '#00d84a',
  'Snow Squall Warning': '#c71585',
  'Dust Storm Warning': '#d2b48c',
  'Blizzard Warning': '#ff4500',
  'Ice Storm Warning': '#b03adb',
  'Winter Storm Warning': '#ff69b4',
  'Lake Effect Snow Warning': '#1fb5b5',
  'High Wind Warning': '#daa520',
  'Hurricane Warning': '#dc143c',
  'Tropical Storm Warning': '#e04040',
  'Storm Surge Warning': '#b524f7',
  'Extreme Heat Warning': '#c71585',
  'Extreme Cold Warning': '#3a7bff',
  'Red Flag Warning': '#ff1493',
  'Freeze Warning': '#7b68ee',
  'Coastal Flood Warning': '#2fbf4f',
  'Avalanche Warning': '#1e90ff',
  'Tornado Watch': '#ffe000',
  'Severe Thunderstorm Watch': '#db7093',
  'Flash Flood Watch': '#3cb371',
  'Flood Watch': '#3cb371',
  'Winter Storm Watch': '#5b9bd5',
  'High Wind Watch': '#b8860b',
  'Hurricane Watch': '#ff00ff',
  'Tropical Storm Watch': '#f08080',
  'Storm Surge Watch': '#db7ff7',
  'Extreme Heat Watch': '#b03060',
  'Extreme Cold Watch': '#5f9ea0',
  'Fire Weather Watch': '#ffdead',
  'Freeze Watch': '#00e5e5',
  'Coastal Flood Watch': '#66cdaa',
};
const RANKS: Record<string, number> = {
  'Tornado Warning': 100,
  'Extreme Wind Warning': 95,
  'Severe Thunderstorm Warning': 90,
  'Flash Flood Warning': 85,
  'Snow Squall Warning': 80,
  'Special Marine Warning': 75,
  'Hurricane Warning': 70,
  'Tornado Watch': 40,
  'Severe Thunderstorm Watch': 35,
};

type Polys = GeoJSON.Position[][][];

/* ------------------------------------------------------------------ */
/*  Geometry                                                           */
/* ------------------------------------------------------------------ */

const round = ([x, y]: GeoJSON.Position): GeoJSON.Position => [Math.round(x * 1e3) / 1e3, Math.round(y * 1e3) / 1e3];

function segDist(p: GeoJSON.Position, a: GeoJSON.Position, b: GeoJSON.Position): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas–Peucker on a closed ring; returns [] when it collapses below a triangle */
function simplifyRing(ring: GeoJSON.Position[], tol: number): GeoJSON.Position[] {
  if (!tol || ring.length <= 5) return ring.length >= 4 ? ring.map(round) : [];
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  // The ring is closed (first == last), so split it at its farthest point from the start first
  let far = 1;
  for (let i = 1; i < ring.length - 1; i++) if (segDist(ring[i], ring[0], ring[0]) > segDist(ring[far], ring[0], ring[0])) far = i;
  keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(ring[i], ring[a], ring[b]);
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0 && max > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = ring.filter((_, i) => keep[i]).map(round);
  return out.length >= 4 ? out : [];
}

function toPolys(g: GeoJSON.Geometry | null, tol: number): Polys {
  if (!g) return [];
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates
    : g.type === 'GeometryCollection' ? g.geometries.flatMap((x) => toPolys(x, 0)) : [];
  return polys.flatMap((rings) => {
    const [outer, ...holes] = rings.map((r) => simplifyRing(r, tol));
    return outer?.length ? [[outer, ...holes.filter((h) => h.length)]] : [];
  });
}

/* ------------------------------------------------------------------ */
/*  Zone outlines (disk cache)                                         */
/* ------------------------------------------------------------------ */

const zoneId = (url: string) => url.split('/').pop() ?? '';

function zoneShape(url: string): Promise<Polys> {
  const id = zoneId(url);
  if (!/^[A-Z]{2}[CZ]\d{3}$/.test(id)) return Promise.resolve([]);
  return cached(`zone:${id}`, 7 * 24 * 3600_000, async () => {
    const file = path.join(ZONE_DIR, `${id}.json`);
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as Polys;
    } catch {
      const polys = toPolys(await nwsZoneGeometry(url), ZONE_TOLERANCE);
      await fs.mkdir(ZONE_DIR, { recursive: true });
      await fs.writeFile(file, JSON.stringify(polys));
      return polys;
    }
  });
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]).catch(() => {});
  }));
}

/* ------------------------------------------------------------------ */
/*  Build                                                              */
/* ------------------------------------------------------------------ */

export type WwaCollection = GeoJSON.FeatureCollection<GeoJSON.MultiPolygon, WwaProps>;

const landZones = (f: NwsAlertFeature) => (f.properties.affectedZones ?? []).filter((u) => !MARINE.test(zoneId(u)));

async function build(): Promise<WwaCollection> {
  const now = Date.now();
  const alerts = (await nwsAlertsActive()).filter((f) => {
    const p = f.properties;
    const level = alertLevel(p.event);
    const end = Date.parse(p.ends ?? p.expires ?? '');
    return (level === 'warning' || level === 'watch') && p.messageType !== 'Cancel' && !(end < now) && (f.geometry || landZones(f).length);
  });

  const shapes = new Map<string, Polys>();
  const urls = [...new Set(alerts.filter((f) => !f.geometry).flatMap(landZones))];
  await pool(urls, 6, async (u) => { shapes.set(u, await zoneShape(u)); });

  const features = alerts.flatMap((f): WwaCollection['features'] => {
    const p = f.properties;
    const coordinates = f.geometry ? toPolys(f.geometry, 0) : landZones(f).flatMap((u) => shapes.get(u) ?? []);
    if (!coordinates.length) return [];
    const level = alertLevel(p.event) as WwaProps['level'];
    return [{
      type: 'Feature',
      properties: {
        id: p.id,
        event: p.event,
        level,
        color: COLORS[p.event] ?? (level === 'warning' ? '#ff5a36' : '#ffd23f'),
        rank: RANKS[p.event] ?? (level === 'warning' ? 50 : 20),
        ends: p.ends ?? p.expires,
      },
      geometry: { type: 'MultiPolygon', coordinates },
    }];
  });
  features.sort((a, b) => a.properties.rank - b.properties.rank);
  return { type: 'FeatureCollection', features };
}

/** Current warning and watch outlines; rebuilt at most once a minute */
export const radarAlerts = () => cached('wwa', 60_000, build);
