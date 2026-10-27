'use client';

import type * as GeoJSON from 'geojson';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { HRRR_BOUNDS, type LngLatBox, type RadarLayer as LayerId, type Win, buildFrames, frameTileLayer } from '@/lib/radarFrames';
import type { RadarManifest, RadarSite, SavedLocation } from '@/lib/types';

import { api } from '../lib/base';
import { fmtDayTimeTz, fmtDuration } from '../lib/format';
import { store } from '../lib/store';
import { PauseIcon, PlayIcon, ReplayIcon, TargetIcon } from './Icons';

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const MIN = 60_000;
/** Night basemap = dark-mode style, Day basemap = light-mode style (.env.local) */
const STYLES = {
  night: process.env.NEXT_PUBLIC_MAPBOX_STYLE_DARK || 'mapbox://styles/mapbox/dark-v11',
  day: process.env.NEXT_PUBLIC_MAPBOX_STYLE_LIGHT || 'mapbox://styles/mapbox/light-v11',
};
const BASEMAP_UI = {
  night: { swatch: 'linear-gradient(135deg,#0f1820 55%,#1f4a66 55% 65%,#0f1820 65%)', label: '#d4dee7', ring: '#5b7184', halo: '#0f1820' },
  day: { swatch: 'linear-gradient(135deg,#ecebe3 55%,#9cc3e0 55% 65%,#ecebe3 65%)', label: '#26323d', ring: '#9a927f', halo: '#ecebe3' },
};
type Basemap = keyof typeof STYLES;

const LAYERS: { id: LayerId; name: string }[] = [
  { id: 'ref', name: 'Reflectivity' },
  { id: 'ptype', name: 'Precip type' },
];

/** Frames are added to the map a few at a time, Now first, so the first image shows quickly on phones */
const LOAD_BATCH = 3;
const SPEED_MS: Record<Win, number> = { 2: 160, 6: 110, 24: 70 };
const RADAR_OPACITY = 0.8;
const RING_KM = 230;

/** Pan limit and "US" view: the lower 48, Alaska, Hawaii, and Puerto Rico */
const US_MAX_BOUNDS: [[number, number], [number, number]] = [[-179.9, 5], [-50, 74]];
const US_VIEW: [[number, number], [number, number]] = [[-170.5, 15.4], [-64.5, 68.7]];

const REF_RAMP = ['#04e9e7', '#019ff4', '#0300f4', '#02fd02', '#01c501', '#008e00', '#fdf802', '#e5bc00', '#fd9500', '#fd0000', '#d40000', '#bc0000', '#f800fd', '#9854c6'];

const intersects = (a: LngLatBox, b: LngLatBox) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

function ringPolygon(lat: number, lon: number, km: number): GeoJSON.Feature<GeoJSON.LineString> {
  const coords: [number, number][] = [];
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * 2 * Math.PI;
    coords.push([lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.sin(a), lat + (km / 110.57) * Math.cos(a)]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
}

function firstRoadLayer(map: mapboxgl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? [];
  return (layers.find((l) => /^(tunnel|road|bridge)/.test(l.id) || (l as { 'source-layer'?: string })['source-layer'] === 'road')
    ?? layers.find((l) => l.type === 'symbol'))?.id;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface Props {
  active: boolean;
  location: SavedLocation;
  locations: SavedLocation[];
  locIdx: number;
  radarSite: RadarSite | null;
  tz: string;
  accent: string;
}

export default function RadarPage({ active, location, locations, locIdx, radarSite, tz, accent }: Props) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const container = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [styleVersion, setStyleVersion] = useState(0);
  // True between `style.load` and the next setStyle(). Not map.isStyleLoaded(): in Mapbox v3 that also
  // waits for every basemap tile, so effects that checked it bailed and never re-ran.
  const styleReady = useRef(false);

  const [manifest, setManifest] = useState<RadarManifest | null>(null);
  const [manifestError, setManifestError] = useState(false);
  const [layer, setLayer] = useState<LayerId>('ref');
  const [basemap, setBasemap] = useState<Basemap>(() => (store.get<string>('wx.basemap', 'night') === 'day' ? 'day' : 'night'));
  const [win, setWin] = useState<Win>(2);
  const [future, setFuture] = useState<boolean>(() => store.get('wx.future', true));
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [view, setView] = useState<LngLatBox | null>(null);

  /* ---- Manifest: fetch on open and every 2 min while visible ---- */
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(api('radar/manifest'));
        if (!r.ok) throw new Error(String(r.status));
        const m = (await r.json()) as RadarManifest;
        if (!stop) { setManifest(m); setManifestError(false); setClock(Date.now()); }
      } catch {
        if (!stop) { setManifestError(true); setClock(Date.now()); }
      }
    };
    load();
    const t = setInterval(load, 2 * MIN);
    return () => { stop = true; clearInterval(t); };
  }, [active]);

  const { frames, nowIdx } = useMemo(
    () => buildFrames(manifestError ? null : manifest, manifestError ? 2 : win, future && !manifestError, clock),
    [manifest, manifestError, win, future, clock],
  );
  const run = manifest?.run ?? null;
  const frame = frames[Math.min(idx, frames.length - 1)];

  /* ---- Opening the page selects the latest observed frame and does not autoplay ---- */
  const wasActive = useRef(false);
  useEffect(() => {
    if (active && !wasActive.current) setIdx(nowIdx);
    if (!active) setPlaying(false);
    wasActive.current = active;
    if (active) requestAnimationFrame(() => mapRef.current?.resize());
  }, [active, nowIdx]);

  // When a newer observed frame arrives, stay on Now if that's where we were; otherwise keep the selection valid
  const prevNowIdx = useRef(nowIdx);
  useEffect(() => {
    const prev = prevNowIdx.current;
    prevNowIdx.current = nowIdx;
    setIdx((i) => (i === prev ? nowIdx : Math.min(i, frames.length - 1)));
  }, [frames.length, nowIdx]);

  /* ---- Map init ---- */
  useEffect(() => {
    if (!token || !container.current || mapRef.current) return;
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: container.current,
      style: STYLES[basemap],
      center: [location.lon, location.lat],
      zoom: 6.6,
      minZoom: 1.5,
      maxZoom: 12,
      maxBounds: US_MAX_BOUNDS,
      projection: 'mercator',
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: false,
      logoPosition: 'bottom-left',
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new mapboxgl.AttributionControl({ compact: true, customAttribution: 'Radar: NOAA via Iowa Environmental Mesonet' }), 'bottom-right');
    map.on('style.load', () => { styleReady.current = true; setStyleVersion((v) => v + 1); });
    const track = () => {
      const b = map.getBounds();
      if (b) setView([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    map.on('moveend', track);
    map.on('load', track);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /* ---- Basemap switch: setStyle wipes custom layers; style.load re-adds them ---- */
  const firstBasemap = useRef(true);
  useEffect(() => {
    store.set('wx.basemap', basemap);
    if (firstBasemap.current) { firstBasemap.current = false; return; }
    styleReady.current = false;
    mapRef.current?.setStyle(STYLES[basemap]);
  }, [basemap]);

  /* ---- Recenter on the selected location, or show the whole US ---- */
  const recenter = useCallback(() => {
    mapRef.current?.easeTo({ center: [location.lon, location.lat], zoom: 6.6, duration: 600 });
  }, [location.lat, location.lon]);
  const showUS = () => mapRef.current?.fitBounds(US_VIEW, { padding: { top: 70, bottom: 230, left: 20, right: 70 }, duration: 600 });
  useEffect(() => {
    mapRef.current?.jumpTo({ center: [location.lon, location.lat], zoom: Math.max(mapRef.current.getZoom(), 5) });
  }, [location.lat, location.lon]);

  /* ---- Radar frame sources: one raster source per region per frame, preloaded from Now outward ---- */
  const frameLayers = useMemo(
    () => frames.map((f) => { const t = frameTileLayer(f, layer, run); return [{ ...t, id: `fwr-${layer}-${t.name}` }]; }),
    [frames, layer, run],
  );
  // Progressive loading: how many frames (in Now-outward order) are on the map so far
  const [budget, setBudget] = useState(1);
  const loadOrder = useMemo(() => {
    const order: number[] = [nowIdx];
    for (let k = 1; order.length < frames.length; k++) {
      if (nowIdx - k >= 0) order.push(nowIdx - k);
      if (nowIdx + k < frames.length) order.push(nowIdx + k);
    }
    return order;
  }, [nowIdx, frames.length]);
  useEffect(() => { setBudget(1); }, [frameLayers, styleVersion]);
  // Jumping to a frame that isn't loaded yet pulls it to the front of the queue
  const wanted = useMemo(() => {
    const set = new Set(loadOrder.slice(0, budget));
    set.add(Math.min(idx, frames.length - 1));
    return [...set];
  }, [loadOrder, budget, idx, frames.length]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    const keep = new Set(frameLayers.flat().map((l) => l.id));
    for (const l of map.getStyle().layers ?? []) {
      if (l.id.startsWith('fwr-') && !keep.has(l.id)) {
        map.removeLayer(l.id);
        if (map.getSource(l.id)) map.removeSource(l.id);
      }
    }
    const before = firstRoadLayer(map);
    for (const i of wanted) {
      for (const { id, name, bounds, maxzoom } of frameLayers[i] ?? []) {
        if (map.getLayer(id)) continue;
        map.addSource(id, {
          type: 'raster',
          // Server tile cache in front of IEM (lib/radar.ts); frames are timestamped and immutable
          tiles: [`${window.location.origin}${api(`radar/tile/${name}/{z}/{x}/{y}.png`)}`],
          tileSize: 256,
          maxzoom,
          ...(bounds ? { bounds } : {}),
        });
        map.addLayer({
          id, type: 'raster', source: id,
          paint: { 'raster-opacity': 0, 'raster-fade-duration': 0, 'raster-opacity-transition': { duration: 0, delay: 0 } },
        }, before);
      }
    }
  }, [frameLayers, wanted, styleVersion]);

  /* ---- Show the current frame by toggling opacity ---- */
  const shownRef = useRef<string[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    const ids = (frameLayers[Math.min(idx, frameLayers.length - 1)] ?? []).map((l) => l.id);
    for (const prev of shownRef.current) {
      if (!ids.includes(prev) && map.getLayer(prev)) map.setPaintProperty(prev, 'raster-opacity', 0);
    }
    for (const id of ids) if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', RADAR_OPACITY);
    shownRef.current = ids;
  }, [idx, frameLayers, styleVersion]);

  /* ---- Preload progress ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let raf = 0;
    const count = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        let n = 0;
        for (const f of frameLayers) if (f.every(({ id }) => map.getSource(id) && map.isSourceLoaded(id))) n++;
        setLoaded(n);
        // Everything added so far is in: queue the next few frames
        setBudget((b) => (n >= Math.min(b, frameLayers.length) && b < frameLayers.length ? b + LOAD_BATCH : b));
      });
    };
    map.on('sourcedata', count);
    map.on('idle', count);
    return () => { map.off('sourcedata', count); map.off('idle', count); cancelAnimationFrame(raf); };
  }, [frameLayers, styleVersion]);

  /* ---- Overlays: saved-location pins, radar site, range ring ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady.current) return;
    const ui = BASEMAP_UI[basemap];
    const locData: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: locations.map((l, i) => ({ type: 'Feature', properties: { sel: i === locIdx ? 1 : 0 }, geometry: { type: 'Point', coordinates: [l.lon, l.lat] } })),
    };
    const siteData: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: radarSite ? [
        { type: 'Feature', properties: { name: radarSite.id }, geometry: { type: 'Point', coordinates: [radarSite.lon, radarSite.lat] } },
        ringPolygon(radarSite.lat, radarSite.lon, RING_KM),
      ] : [],
    };
    const upsert = (id: string, data: GeoJSON.FeatureCollection) => {
      const src = map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
      if (src) src.setData(data); else map.addSource(id, { type: 'geojson', data });
    };
    upsert('fw-locs', locData);
    upsert('fw-site', siteData);
    if (!map.getLayer('fw-ring')) {
      map.addLayer({ id: 'fw-ring', type: 'line', source: 'fw-site', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': ui.ring, 'line-width': 1, 'line-dasharray': [2, 4] } });
      map.addLayer({ id: 'fw-site-dot', type: 'circle', source: 'fw-site', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 4, 'circle-color': ui.label, 'circle-stroke-color': ui.halo, 'circle-stroke-width': 1.5 } });
      map.addLayer({
        id: 'fw-site-label', type: 'symbol', source: 'fw-site', filter: ['==', ['geometry-type'], 'Point'],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['DIN Pro Bold', 'Arial Unicode MS Bold'], 'text-size': 11, 'text-offset': [0.8, 0], 'text-anchor': 'left' },
        paint: { 'text-color': ui.label, 'text-halo-color': ui.halo, 'text-halo-width': 1.5 },
      });
      map.addLayer({ id: 'fw-locs-halo', type: 'circle', source: 'fw-locs', paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 10, 7], 'circle-color': accent, 'circle-opacity': ['case', ['==', ['get', 'sel'], 1], 0.28, 0.16] } });
      map.addLayer({ id: 'fw-locs-dot', type: 'circle', source: 'fw-locs', paint: { 'circle-radius': ['case', ['==', ['get', 'sel'], 1], 5, 3.5], 'circle-color': accent, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    } else {
      map.setPaintProperty('fw-locs-halo', 'circle-color', accent);
      map.setPaintProperty('fw-locs-dot', 'circle-color', accent);
    }
  }, [locations, locIdx, radarSite, accent, basemap, styleVersion]);

  /* ---- Loop ---- */
  const idxRef = useRef(idx);
  idxRef.current = idx;
  useEffect(() => {
    if (!playing) return;
    const speed = SPEED_MS[manifestError ? 2 : win];
    const last = frames.length - 1;
    let raf = 0, prev = 0, hold = 0;
    const tick = (ts: number) => {
      if (!prev) prev = ts;
      if (ts - prev >= speed) {
        const dt = ts - prev;
        prev = ts;
        const i = idxRef.current;
        if (i >= last) {
          hold += dt;
          if (hold >= 600) { hold = 0; setIdx(0); }
        } else if (i === nowIdx && last > nowIdx && hold < 400) {
          hold += dt; // pause on the Now frame before entering the forecast
        } else {
          hold = 0;
          setIdx(i + 1);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, frames.length, nowIdx, win, manifestError]);

  /* ---- Map controls clear the timeline ---- */
  useEffect(() => {
    const el = timelineRef.current;
    const page = pageRef.current;
    if (!el || !page) return;
    const ro = new ResizeObserver(() => page.style.setProperty('--tl-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [token]);

  /* ---- Labels ---- */
  const isFuture = !!frame?.future;
  const latestMs = frames[nowIdx]?.time ?? clock;
  let subtitle: React.ReactNode = null;
  if (frame) {
    if (frame.future) {
      const ahead = Math.max(5, Math.round((frame.time - Date.now()) / MIN / 5) * 5);
      const older = run && Date.now() - Date.parse(run) > 3 * 60 * MIN;
      subtitle = <><b className="fc">Forecast</b> +{fmtDuration(ahead)} · {manifest?.runLabel} run{older ? ' (older run)' : ''}</>;
    } else if (idx === nowIdx) {
      subtitle = 'Latest observed frame · NEXRAD';
    } else {
      subtitle = `${fmtDuration(Math.round((latestMs - frame.time) / MIN))} ago · NEXRAD`;
    }
  }
  const span = Math.max(1, frames.length - 1);
  const nowPct = (nowIdx / span) * 100;
  const hasFuture = frames.length - 1 > nowIdx;
  const fcstHours = hasFuture ? Math.round((frames[frames.length - 1].time - latestMs) / (60 * MIN)) : 0;
  const staleMin = manifest ? Math.round((Date.now() - Date.parse(manifest.latestObs)) / MIN) : 0;
  const pageWin = manifestError ? 2 : win;

  let note: { text: string; warn?: boolean } | null = null;
  if (manifestError) note = { text: "Couldn't load the radar schedule. Showing the past 2 hours.", warn: true };
  else if (manifest?.stale) note = { text: `Radar delayed · newest frame ${staleMin} min old`, warn: true };
  else if (future && manifest && !manifest.run) note = { text: 'Forecast radar unavailable right now', warn: true };

  if (!token) {
    return (
      <section className="page radar" aria-label="Radar" hidden={!active}>
        <div className="radar-empty">
          <p>Mapbox token not configured. Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to <code>.env.local</code> to enable radar.</p>
        </div>
      </section>
    );
  }

  return (
    <section ref={pageRef} className={`page radar${isFuture ? ' is-future' : ''}`} aria-label="Radar" hidden={!active}>
      <div ref={container} className="radar-map" role="region" aria-label="Radar map" />
      {loaded < frames.length && (
        <div className="tl-load" aria-hidden="true"><i style={{ width: `${(loaded / Math.max(1, frames.length)) * 100}%` }} /></div>
      )}

      <div className="ov layers" role="group" aria-label="Radar layer">
        {LAYERS.map((l) => (
          <button key={l.id} className="seg glass" aria-pressed={layer === l.id} onClick={() => setLayer(l.id)}>{l.name}</button>
        ))}
      </div>
      <div className="ov basemaps glass" role="group" aria-label="Map style">
        {(['night', 'day'] as const).map((b) => (
          <button key={b} className="bm" aria-pressed={basemap === b} style={{ background: BASEMAP_UI[b].swatch }} aria-label={`${b === 'night' ? 'Night' : 'Day'} map`} onClick={() => setBasemap(b)}>
            <span>{b.toUpperCase()}</span>
          </button>
        ))}
      </div>
      <div className="ov zoom glass">
        <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
        <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
        <button aria-label="Recenter on location" onClick={recenter}><TargetIcon /></button>
        <button className="us-btn" aria-label="Show all of the US, including Alaska and Hawaii" onClick={showUS}>US</button>
      </div>

      {isFuture ? (
        <div className="ov fc-badge">
          <ReplayIcon />Model forecast · {view && !intersects(view, HRRR_BOUNDS) ? 'lower 48 only' : 'not observed radar'}
        </div>
      ) : note && (
        <div className={`ov radar-note glass${note.warn ? ' warn' : ''}`} role="status">{note.text}</div>
      )}

      <div className="ov timeline glass" ref={timelineRef}>
        <div className="tl-row">
          <button
            className="play" aria-label={playing ? 'Pause loop' : 'Play loop'}
            onClick={() => { if (!playing && idx >= frames.length - 1) setIdx(0); setPlaying(!playing); }}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className="tl-time" aria-live="off">
            {frame ? fmtDayTimeTz(frame.time, tz) : '--'}
            <small>{subtitle}</small>
          </div>
          <button className="now-btn" aria-pressed={idx === nowIdx} aria-label="Jump to latest observed frame" onClick={() => { setPlaying(false); setIdx(nowIdx); }}>
            Now
          </button>
        </div>
        <div className="tl-row tl-opts">
          <div className="win" role="group" aria-label="Past hours">
            {([2, 6, 24] as const).map((h) => (
              <button key={h} aria-pressed={pageWin === h} disabled={manifestError} onClick={() => setWin(h)}>{h}h</button>
            ))}
          </div>
          <button
            className="fut-btn" aria-pressed={future} disabled={manifestError}
            onClick={() => { const v = !future; setFuture(v); store.set('wx.future', v); }}
          >
            +18 h forecast
          </button>
        </div>
        <div className="tl-track">
          <div className="tl-bar" aria-hidden="true">
            <i className={`past${hasFuture ? '' : ' only'}`} style={{ width: `${hasFuture ? nowPct : 100}%` }} />
            {hasFuture && <i className="fut" style={{ width: `${100 - nowPct}%` }} />}
            <b className="now-tick" style={{ left: `${hasFuture ? nowPct : 100}%` }} />
          </div>
          <input
            type="range" min={0} max={frames.length - 1} value={Math.min(idx, frames.length - 1)} aria-label="Radar time"
            aria-valuetext={frame ? fmtDayTimeTz(frame.time, tz) : undefined}
            onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
          />
        </div>
        <div className="tl-ends" aria-hidden="true">
          <span>−{pageWin} h</span>
          {hasFuture ? (
            <>
              <span style={{ position: 'absolute', left: `${nowPct}%`, transform: 'translateX(-50%)' }}>now</span>
              <span>+{fcstHours} h</span>
            </>
          ) : <span>now</span>}
        </div>
        <div className="legend">
          {layer === 'ref' ? (
            <>
              <span>dBZ</span><span>5</span>
              <span className="ramp" style={{ background: `linear-gradient(90deg,${REF_RAMP.join(',')})` }} />
              <span>70+</span>
            </>
          ) : (
            <>
              <span className="sw"><i style={{ background: '#40aa5d' }} />Rain</span>
              <span className="sw"><i style={{ background: '#1b8db3' }} />Snow</span>
              <span className="sw"><i style={{ background: 'linear-gradient(90deg,#9e9ac8 50%,#fcc2aa 50%)' }} />Ice / mix</span>
              <span style={{ marginLeft: 'auto' }}>{isFuture ? 'HRRR' : 'MRMS'}</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
