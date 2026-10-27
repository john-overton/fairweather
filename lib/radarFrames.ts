/**
 * Radar frame schedule and IEM tile-layer naming, shared by the Radar page and the
 * server's tile cache/prewarm job so both ask for exactly the same tiles.
 */
import type { RadarManifest } from './types';

const MIN = 60_000;

export type Win = 2 | 6 | 24;
export type RadarLayer = 'ref' | 'ptype';
export type LngLatBox = [number, number, number, number];

/** Observed frame step per window. 24 h uses 30-min steps to keep phone GPU memory in check. */
export const OBS_STEP_MIN: Record<Win, number> = { 2: 10, 6: 10, 24: 30 };
export const FCST_STEP_MIN = 30;
/** Observed N0Q mosaic is ~1 km; HRRR is a 3 km model, so z6 forecast tiles lose nothing and cost 1/16 as much. */
export const OBS_MAXZOOM = 8;
export const FCST_MAXZOOM = 6;
/** HRRR forecast tiles cover the lower 48 only */
export const HRRR_BOUNDS: LngLatBox = [-126, 23.2, -65, 50];

export interface Frame { id: string; time: number; future: boolean; minute?: number }

/** UTC YYYYMMDDHHmm */
export const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 12);
export const parseStamp = (s: string) =>
  Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12));

export function buildFrames(m: RadarManifest | null, win: Win, future: boolean, now: number): { frames: Frame[]; nowIdx: number } {
  const step = OBS_STEP_MIN[win] * MIN;
  // Without a manifest, assume the archive is ~10 min behind and use 5-minute mosaics
  const latest = m ? Date.parse(m.latestObs) : Math.floor((now - 10 * MIN) / (5 * MIN)) * 5 * MIN;
  const aligned = Math.floor(latest / step) * step;
  const frames: Frame[] = [];
  for (let t = aligned - win * 60 * MIN; t <= aligned; t += step) frames.push({ id: `o${t}`, time: t, future: false });
  if (latest > aligned) frames.push({ id: `o${latest}`, time: latest, future: false });
  const nowIdx = frames.length - 1;
  if (future && m?.run) {
    for (const f of m.forecast) {
      if (f.minute % FCST_STEP_MIN === 0) frames.push({ id: `f${f.minute}`, time: Date.parse(f.valid), future: true, minute: f.minute });
    }
  }
  return { frames, nowIdx };
}

/**
 * IEM tile layer for a frame. IEM's `ridge::USCOMP-N0Q-*` tiles are a national mosaic that already
 * includes Alaska, Hawaii, and Puerto Rico; forecast frames are HRRR (lower 48) pinned to one run.
 */
export function frameTileLayer(frame: Frame, layer: RadarLayer, run: string | null): { name: string; bounds?: LngLatBox; maxzoom: number } {
  if (!frame.future) return { name: `ridge::USCOMP-N0Q-${stamp(frame.time)}`, maxzoom: OBS_MAXZOOM };
  const f = String(frame.minute).padStart(4, '0');
  return { name: `hrrr::${layer === 'ptype' ? 'REFP' : 'REFD'}-F${f}-${stamp(Date.parse(run!))}`, bounds: HRRR_BOUNDS, maxzoom: FCST_MAXZOOM };
}

/** Slippy-map tile containing a point */
export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}
