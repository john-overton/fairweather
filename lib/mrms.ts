/**
 * Observed precipitation type from NOAA MRMS on AWS (noaa-mrms-pds), rendered to radar tiles.
 *
 * Per frame and domain, two 2-minute GRIB2 products on the same 0.01° grid:
 *   PrecipFlag_00.00                  type (rain, snow, rain with hail)
 *   MergedBaseReflectivityQC_00.50    intensity (dBZ)
 * Both use GRIB2 data template 5.41 (the field is a grayscale PNG), decoded with lib/png.ts.
 */
import zlib from 'node:zlib';

import { decodeGray, encodeRGBA } from './png';
import { cached } from './sources';

const BUCKET = 'https://noaa-mrms-pds.s3.amazonaws.com';
const MIN = 60_000;
const PRODUCTS = { flag: 'PrecipFlag_00.00', ref: 'MergedBaseReflectivityQC_00.50' } as const;

/** Domains and rough extents (west, south, east, north) so tiles skip domains they don't touch */
const DOMAINS: { id: string; box: [number, number, number, number] }[] = [
  { id: 'CONUS', box: [-130, 20, -60, 55] },
  { id: 'ALASKA', box: [-180, 50, -125, 75] },
  { id: 'HAWAII', box: [-165, 15, -150, 26] },
];

/* ------------------------------------------------------------------ */
/*  Bucket listing                                                     */
/* ------------------------------------------------------------------ */

const keyTime = (key: string) => {
  const m = key.match(/_(\d{8})-(\d{6})\.grib2\.gz$/);
  if (!m) return NaN;
  const [d, t] = [m[1], m[2]];
  return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
};

async function listDay(domain: string, product: string, day: string): Promise<{ t: number; key: string }[]> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return cached(`mrms-list:${domain}/${product}/${day}`, day === today ? 2 * MIN : 60 * MIN, async () => {
    const out: { t: number; key: string }[] = [];
    let token = '';
    do {
      const url = `${BUCKET}/?list-type=2&prefix=${domain}/${product}/${day}/&max-keys=1000${token ? `&continuation-token=${encodeURIComponent(token)}` : ''}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
      if (!res.ok) throw new Error(`MRMS list ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) out.push({ t: keyTime(m[1]), key: m[1] });
      token = xml.match(/<NextContinuationToken>([^<]+)</)?.[1] ?? '';
    } while (token);
    return out.filter((k) => Number.isFinite(k.t)).sort((a, b) => a.t - b.t);
  });
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

/** Newest file at or just before `t` (within 10 minutes). */
async function keyAtOrBefore(domain: string, product: string, t: number): Promise<string | null> {
  const days = [...new Set([dayOf(t - 10 * MIN), dayOf(t + MIN)])];
  const keys = (await Promise.all(days.map((d) => listDay(domain, product, d).catch(() => [])))).flat();
  let best: { t: number; key: string } | null = null;
  for (const k of keys) if (k.t <= t + MIN && k.t >= t - 10 * MIN && (!best || k.t > best.t)) best = k;
  return best?.key ?? null;
}

/** Time of the newest CONUS frame for which both products exist. */
export async function latestPtypeTime(): Promise<number> {
  const day = dayOf(Date.now());
  const [f, r] = await Promise.all([listDay('CONUS', PRODUCTS.flag, day), listDay('CONUS', PRODUCTS.ref, day)]);
  return Math.min(f.at(-1)?.t ?? 0, r.at(-1)?.t ?? 0);
}

/* ------------------------------------------------------------------ */
/*  GRIB2 (single field, lat/lon grid, template 5.41)                  */
/* ------------------------------------------------------------------ */

interface Field { nx: number; ny: number; la1: number; lo1: number; di: number; dj: number; values: (i: number) => number }

function parseGrib(buf: Buffer): Field {
  if (buf.toString('ascii', 0, 4) !== 'GRIB' || buf[7] !== 2) throw new Error('not GRIB2');
  let nx = 0, ny = 0, la1 = 0, lo1 = 0, di = 0, dj = 0, R = 0, E = 0, D = 0, tpl = -1;
  let png: Buffer | null = null;
  for (let i = 16; i < buf.length - 4;) {
    if (buf.toString('ascii', i, i + 4) === '7777') break;
    const len = buf.readUInt32BE(i);
    const sec = buf[i + 4];
    if (sec === 3) {
      if (buf.readUInt16BE(i + 12) !== 0) throw new Error('unsupported grid template');
      nx = buf.readUInt32BE(i + 30); ny = buf.readUInt32BE(i + 34);
      la1 = buf.readInt32BE(i + 46) / 1e6; lo1 = buf.readUInt32BE(i + 50) / 1e6;
      di = buf.readUInt32BE(i + 63) / 1e6; dj = buf.readUInt32BE(i + 67) / 1e6;
      if (buf[i + 71] !== 0) throw new Error('unsupported scan mode');
    } else if (sec === 5) {
      tpl = buf.readUInt16BE(i + 9);
      R = buf.readFloatBE(i + 11); E = buf.readInt16BE(i + 15); D = buf.readInt16BE(i + 17);
    } else if (sec === 7) {
      png = buf.subarray(i + 5, i + len);
    }
    i += len;
  }
  if (tpl !== 41 || !png) throw new Error(`unsupported data template ${tpl}`);
  const img = decodeGray(png);
  if (img.width !== nx || img.height !== ny) throw new Error('grid/image size mismatch');
  const scaleE = 2 ** E, scaleD = 10 ** D;
  return {
    nx, ny, la1, lo1: lo1 > 180 ? lo1 - 360 : lo1, di, dj,
    values: (k) => (R + img.data[k] * scaleE) / scaleD,
  };
}

async function fetchField(key: string): Promise<Field> {
  const res = await fetch(`${BUCKET}/${key}`, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!res.ok) throw new Error(`MRMS ${res.status} ${key}`);
  return parseGrib(zlib.gunzipSync(Buffer.from(await res.arrayBuffer())));
}

/* ------------------------------------------------------------------ */
/*  Combined frame grid: one byte per cell = (type << 4) | dBZ bin     */
/* ------------------------------------------------------------------ */

const NONE = 0, RAIN = 1, SNOW = 2, MIX = 3;
/** PrecipFlag codes: 1 warm stratiform, 3 snow, 6 convective, 7 rain with hail, 10 cold stratiform, 91/96 tropical */
const FLAG_TYPE: Record<number, number> = { 1: RAIN, 3: SNOW, 6: RAIN, 7: MIX, 10: RAIN, 91: RAIN, 96: RAIN };

interface FrameGrid { nx: number; ny: number; la1: number; lo1: number; di: number; dj: number; cells: Uint8Array }

async function buildGrid(domain: string, t: number): Promise<FrameGrid | null> {
  const [fk, rk] = await Promise.all([keyAtOrBefore(domain, PRODUCTS.flag, t), keyAtOrBefore(domain, PRODUCTS.ref, t)]);
  if (!fk || !rk) return null;
  const [flag, ref] = await Promise.all([fetchField(fk), fetchField(rk)]);
  if (flag.nx !== ref.nx || flag.ny !== ref.ny) throw new Error(`${domain} grids differ`);
  const cells = new Uint8Array(flag.nx * flag.ny);
  for (let k = 0; k < cells.length; k++) {
    const type = FLAG_TYPE[Math.round(flag.values(k))] ?? NONE;
    if (!type) continue;
    const dbz = ref.values(k);
    if (!(dbz >= 5)) continue;
    cells[k] = (type << 4) | Math.min(14, Math.floor(dbz / 5));
  }
  return { nx: flag.nx, ny: flag.ny, la1: flag.la1, lo1: flag.lo1, di: flag.di, dj: flag.dj, cells };
}

// A CONUS grid is 24.5 MB; keep the few frames being rendered right now
const LRU_SIZE = 4;
const grids = new Map<string, Promise<FrameGrid | null>>();

function frameGrid(domain: string, t: number): Promise<FrameGrid | null> {
  const key = `${domain}:${t}`;
  const hit = grids.get(key);
  if (hit) {
    grids.delete(key);
    grids.set(key, hit);
    return hit;
  }
  const p = buildGrid(domain, t).catch((e) => {
    console.warn(`[fairweather] MRMS ${key} failed:`, (e as Error).message);
    grids.delete(key);
    return null;
  });
  grids.set(key, p);
  while (grids.size > LRU_SIZE) grids.delete(grids.keys().next().value!);
  return p;
}

/* ------------------------------------------------------------------ */
/*  Colors (spec ramps) and tile rendering                             */
/* ------------------------------------------------------------------ */

const RAMPS: Record<number, [number, string][]> = {
  [RAIN]: [[5, '#8fe08f'], [15, '#4cc35a'], [25, '#2fae4a'], [35, '#f2d43a'], [45, '#f29e38'], [50, '#e0452e'], [60, '#b0217a']],
  [SNOW]: [[5, '#b8d8ff'], [15, '#7fb3f5'], [25, '#3a78e0'], [35, '#1f4fb0']],
  [MIX]: [[5, '#f7b6d2'], [20, '#ec8cbc'], [30, '#e05fa0']],
};

/** RGBA per cell byte */
const PALETTE = (() => {
  const p = new Uint8Array(256 * 4);
  for (const [type, ramp] of Object.entries(RAMPS)) {
    for (let bin = 1; bin <= 14; bin++) {
      const dbz = bin * 5;
      const hex = [...ramp].reverse().find(([v]) => dbz >= v)?.[1] ?? ramp[0][1];
      const o = ((Number(type) << 4) | bin) * 4;
      p[o] = parseInt(hex.slice(1, 3), 16); p[o + 1] = parseInt(hex.slice(3, 5), 16); p[o + 2] = parseInt(hex.slice(5, 7), 16);
      p[o + 3] = dbz < 15 ? 170 : 235;
    }
  }
  return p;
})();

/** Render one 256px Web Mercator tile of observed precip type for frame time `t`. */
export async function renderPtypeTile(t: number, z: number, x: number, y: number): Promise<Buffer> {
  const n = 2 ** z;
  const lon = (px: number) => ((x + px / 256) / n) * 360 - 180;
  const lat = (py: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / 256)) / n))) * 180) / Math.PI;
  const box: [number, number, number, number] = [lon(0), lat(256), lon(256), lat(0)];
  const rgba = new Uint8Array(256 * 256 * 4);

  const domains = DOMAINS.filter((d) => box[0] < d.box[2] && box[2] > d.box[0] && box[1] < d.box[3] && box[3] > d.box[1]);
  for (const d of domains) {
    const g = await frameGrid(d.id, t);
    if (!g) continue;
    const cols = new Int32Array(256);
    for (let i = 0; i < 256; i++) cols[i] = Math.round((lon(i + 0.5) - g.lo1) / g.di);
    for (let j = 0; j < 256; j++) {
      const row = Math.round((g.la1 - lat(j + 0.5)) / g.dj);
      if (row < 0 || row >= g.ny) continue;
      for (let i = 0; i < 256; i++) {
        const col = cols[i];
        if (col < 0 || col >= g.nx) continue;
        const cell = g.cells[row * g.nx + col];
        if (!cell) continue;
        const o = (j * 256 + i) * 4, p = cell * 4;
        rgba[o] = PALETTE[p]; rgba[o + 1] = PALETTE[p + 1]; rgba[o + 2] = PALETTE[p + 2]; rgba[o + 3] = PALETTE[p + 3];
      }
    }
  }
  return encodeRGBA(256, 256, rgba);
}
