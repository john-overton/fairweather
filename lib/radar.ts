import fs from 'node:fs/promises';
import path from 'node:path';

import { latestPtypeTime, renderPtypeTile } from './mrms';
import { FCST_MAXZOOM, OBS_MAXZOOM, PTYPE_MAXZOOM, buildFrames, frameTileLayer, lonLatToTile, parseStamp } from './radarFrames';
import { iemHrrrInit, iemLatestComposite } from './sources';
import type { RadarManifest } from './types';

const MIN = 60_000;
const FORECAST_MAX_MINUTE = 18 * 60;

/**
 * Radar manifest. Observed frames come from the IEM NEXRAD composite archive
 * (5-minute N0Q mosaics); forecast frames from the newest complete HRRR run on
 * IEM (15-minute sub-hourly REFD/REFP). Frame URLs are built client-side from
 * these times, pinned to the run so mixed-run frames are never shown, and fetched
 * through the tile cache below.
 */
export async function radarManifest(): Promise<RadarManifest> {
  const now = Date.now();
  const [latest, init] = await Promise.all([
    iemLatestComposite(),
    iemHrrrInit().catch(() => null),
  ]);
  const latestMs = Date.parse(latest);

  const forecast: RadarManifest['forecast'] = [];
  if (init) {
    const initMs = Date.parse(init);
    for (let m = 0; m <= FORECAST_MAX_MINUTE; m += 15) {
      const valid = initMs + m * MIN;
      if (valid <= latestMs) continue;
      if (valid > now + FORECAST_MAX_MINUTE * MIN) break;
      forecast.push({ valid: new Date(valid).toISOString(), minute: m });
    }
  }

  return {
    latestObs: new Date(latestMs).toISOString(),
    stale: now - latestMs > 20 * MIN,
    run: init,
    runLabel: init ? `HRRR ${init.slice(11, 13)}Z` : null,
    forecast,
    updated: new Date(now).toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/*  Tile cache: IEM tiles stored on disk, served immutable             */
/* ------------------------------------------------------------------ */

const TILE_DIR = process.env.FAIRWEATHER_TILE_DIR || path.join(/* turbopackIgnore: true */ process.cwd(), 'data', 'tiles');
const IEM_HOSTS = ['mesonet1', 'mesonet2', 'mesonet3'];
const OBS_KEEP_MS = 25 * 60 * MIN;
const OBS_RE = /^ridge::USCOMP-N0Q-(\d{12})$/;
const FCST_RE = /^hrrr::REF[DP]-F(\d{4})-(\d{12})$/;
const PTYPE_RE = /^mrms::PTYPE-(\d{12})$/;

export interface TileRequest { layer: string; z: number; x: number; y: number }

/**
 * Only frames the app can actually ask for: observed mosaics from the last 25 h on the 5-minute grid,
 * and HRRR frames from runs in the last 30 h. Keeps the cache (and IEM traffic) bounded.
 */
export function validTile(t: TileRequest): boolean {
  const { layer, z, x, y } = t;
  if (![z, x, y].every(Number.isInteger) || z < 0 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return false;
  const now = Date.now();
  const obs = layer.match(OBS_RE) ?? layer.match(PTYPE_RE);
  if (obs) {
    const ms = parseStamp(obs[1]);
    const maxz = layer.startsWith('mrms::') ? PTYPE_MAXZOOM : OBS_MAXZOOM;
    return z <= maxz && ms % (5 * MIN) === 0 && ms > now - OBS_KEEP_MS && ms < now + 5 * MIN;
  }
  const fc = layer.match(FCST_RE);
  if (fc) {
    const minute = Number(fc[1]), run = parseStamp(fc[2]);
    return z <= FCST_MAXZOOM && minute % 15 === 0 && minute <= 18 * 60 && run % (60 * MIN) === 0 && run > now - 30 * 60 * MIN && run < now;
  }
  return false;
}

const tilePath = (t: TileRequest) => path.join(TILE_DIR, t.layer.replace('::', '__'), String(t.z), String(t.x), `${t.y}.png`);
const inflight = new Map<string, Promise<Buffer | null>>();
let hostTurn = 0;

/** Can this tile be cached forever? Observed frames newer than the latest available data might still be filling in. */
async function isFinal(layer: string): Promise<boolean> {
  try {
    const obs = layer.match(OBS_RE);
    if (obs) return parseStamp(obs[1]) <= Date.parse(await iemLatestComposite());
    const pt = layer.match(PTYPE_RE);
    if (pt) return parseStamp(pt[1]) <= (await latestPtypeTime());
    return true; // HRRR runs are only listed once complete
  } catch {
    return false;
  }
}

/** Returns the PNG and whether it is final (immutable), or null if IEM had nothing. */
export async function radarTile(t: TileRequest): Promise<{ png: Buffer; final: boolean; fromCache: boolean } | null> {
  const file = tilePath(t);
  try {
    return { png: await fs.readFile(file), final: true, fromCache: true };
  } catch { /* not cached yet */ }

  const final = await isFinal(t.layer);
  let p = inflight.get(file);
  if (!p) {
    p = (async () => {
      const pt = t.layer.match(PTYPE_RE);
      const png = pt ? await renderPtypeTile(parseStamp(pt[1]), t.z, t.x, t.y) : await fetchIem(t);
      if (png && final) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        await fs.writeFile(tmp, png);
        await fs.rename(tmp, file);
      }
      return png;
    })().catch(() => null).finally(() => inflight.delete(file));
    inflight.set(file, p);
  }
  const png = await p;
  return png ? { png, final, fromCache: false } : null;
}

async function fetchIem(t: TileRequest): Promise<Buffer | null> {
  const host = IEM_HOSTS[hostTurn++ % IEM_HOSTS.length];
  const res = await fetch(`https://${host}.agron.iastate.edu/cache/tile.py/1.0.0/${t.layer}/${t.z}/${t.x}/${t.y}.png`, {
    signal: AbortSignal.timeout(15000),
    cache: 'no-store',
  });
  if (!res.ok || !res.headers.get('content-type')?.includes('image/png')) return null;
  return Buffer.from(await res.arrayBuffer());
}

/* ------------------------------------------------------------------ */
/*  Prewarm and prune (cron job "radar")                               */
/* ------------------------------------------------------------------ */

/** Tiles covering a phone-to-desktop view around each point at the default zoom (6.6). */
function tilesAround(points: { lat: number; lon: number }[], z: number): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const { lat, lon } of points) {
    const [x0, y0] = lonLatToTile(lon - 3.2, lat + 2.2, z);
    const [x1, y1] = lonLatToTile(lon + 3.2, lat - 2.2, z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) seen.set(`${x}/${y}`, [x, y]);
  }
  return [...seen.values()];
}

/**
 * Fetch into the cache the frames a phone opening the Radar page will ask for first:
 * the default 2 h observed loop plus the first 6 h of forecast, around each point.
 */
export async function prewarmRadar(points: { lat: number; lon: number }[]) {
  const m = await radarManifest();
  const { frames } = buildFrames(m, 2, true, Date.now());
  const latest = Date.parse(m.latestObs);
  const jobs: TileRequest[] = [];
  for (const f of frames) {
    if (f.future && f.time > latest + 6 * 60 * MIN) continue;
    for (const layer of ['ref', 'ptype'] as const) {
      const { name, maxzoom } = frameTileLayer(f, layer, m.run);
      for (const [x, y] of tilesAround(points, maxzoom)) jobs.push({ layer: name, z: maxzoom, x, y });
    }
  }
  let fetched = 0, failed = 0, i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      const r = await radarTile(job);
      if (!r) failed++;
      else if (!r.fromCache) fetched++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { points: points.length, tiles: jobs.length, fetched, failed };
}

/** Delete observed frames (reflectivity and precip type) older than 25 h and every HRRR run except the newest two. */
export async function pruneRadarTiles() {
  let dirs: string[];
  try {
    dirs = await fs.readdir(TILE_DIR);
  } catch {
    return { removed: 0 };
  }
  const now = Date.now();
  const runs = [...new Set(dirs.map((d) => d.match(/^hrrr__REF[DP]-F\d{4}-(\d{12})$/)?.[1]).filter(Boolean) as string[])].sort().reverse();
  const keepRuns = new Set(runs.slice(0, 2));
  let removed = 0;
  for (const d of dirs) {
    const obs = d.match(/^(?:ridge__USCOMP-N0Q|mrms__PTYPE)-(\d{12})$/);
    const fc = d.match(/^hrrr__REF[DP]-F\d{4}-(\d{12})$/);
    const stale = obs ? parseStamp(obs[1]) < now - OBS_KEEP_MS : fc ? !keepRuns.has(fc[1]) : false;
    if (stale) {
      await fs.rm(path.join(TILE_DIR, d), { recursive: true, force: true });
      removed++;
    }
  }
  return { removed, runsKept: [...keepRuns] };
}
