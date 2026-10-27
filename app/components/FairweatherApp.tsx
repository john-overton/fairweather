'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ForecastResponse, SavedLocation } from '@/lib/types';

import { BASE, api } from '../lib/base';
import { fmtAge, fmtTime } from '../lib/format';
import { type PushState, loadPushState, pushOnLoad, syncPush } from '../lib/push';
import { store, migrateStore } from '../lib/store';
import { THEMES, type Mode, applyTheme } from '../lib/theme';
import HourlyPage from './HourlyPage';
import { ChevronDown, MoonIcon, PaletteIcon, SunIcon, TAB_ICONS } from './Icons';
import NowPage from './NowPage';
import { AboutSheet, LocationSheet, NotificationsSheet, ThemeSheet, newLocId } from './Sheets';
import TenDayPage from './TenDayPage';

const RadarPage = dynamic(() => import('./RadarPage'), { ssr: false });

type PageId = 'now' | 'hourly' | 'ten-day' | 'radar';
const PAGES: { id: PageId; label: string }[] = [
  { id: 'now', label: 'Now' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'ten-day', label: '10-Day' },
  { id: 'radar', label: 'Radar' },
];
const DEFAULT_LOC: SavedLocation = { id: 'kc', name: 'Kansas City, MO', lat: 39.0997, lon: -94.5786 };
const REFRESH_MS = 10 * 60_000;
const STALE_MS = 30 * 60_000;

interface Cached { data: ForecastResponse; fetchedAt: number }
type Sheet = null | 'locations' | 'theme' | 'notifications' | 'about';

const fcKey = (l: SavedLocation) => `${l.lat.toFixed(2)},${l.lon.toFixed(2)}`;
const pageFromHash = (): PageId => {
  const h = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return (PAGES.some((p) => p.id === h) ? h : 'now') as PageId;
};

function validLocations(v: unknown): SavedLocation[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const ok = v.filter((l) => l && typeof l.name === 'string' && Number.isFinite(l.lat) && Number.isFinite(l.lon))
    .map((l) => ({ id: typeof l.id === 'string' ? l.id : newLocId(), name: l.name, lat: l.lat, lon: l.lon }));
  return ok.length ? ok : null;
}

export default function FairweatherApp() {
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState<PageId>('now');
  const [radarSeen, setRadarSeen] = useState(false);
  const [locations, setLocations] = useState<SavedLocation[]>([DEFAULT_LOC]);
  const [locIdx, setLocIdx] = useState(0);
  const [themeId, setThemeId] = useState('prairie');
  const [mode, setMode] = useState<Mode>('system');
  const [systemDark, setSystemDark] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [push, setPush] = useState<PushState>({ on: false, prefs: loadPushState().prefs });
  const [forecasts, setForecasts] = useState<Record<string, Cached>>({});
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  const loc = locations[Math.min(locIdx, locations.length - 1)] ?? DEFAULT_LOC;
  const entry = forecasts[fcKey(loc)];
  const data = entry?.data ?? null;

  /* ---- Boot: read storage after hydration ---- */
  useEffect(() => {
    migrateStore();
    const locs = validLocations(store.get('wx.locations', null)) ?? [DEFAULT_LOC];
    setLocations(locs);
    setLocIdx(Math.max(0, Math.min(store.get('wx.locIdx', 0), locs.length - 1)));
    const t = store.get('wx.themeId', 'prairie');
    setThemeId(THEMES.some((x) => x.id === t) ? t : 'prairie');
    const m = store.get<Mode>('wx.mode', 'system');
    setMode(m === 'light' || m === 'dark' ? m : 'system');
    const cached: Record<string, Cached> = {};
    for (const l of locs) {
      const c = store.get<Cached | null>(`wx.fc.${fcKey(l)}`, null);
      if (c?.data?.now) cached[fcKey(l)] = c;
    }
    setForecasts(cached);
    setPush(loadPushState());
    setPage(pageFromHash());
    setOnline(navigator.onLine);
    setReady(true);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: BASE })
        .then(() => pushOnLoad(locs))
        .then((s) => { if (s) setPush(s); })
        .catch(() => { /* offline install unavailable; app still works */ });
    }
  }, []);

  /* ---- Theme ---- */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    if (!ready) return;
    applyTheme(themeId, mode);
  }, [ready, themeId, mode, systemDark]);
  // Derived from state (not matchMedia) so the first client render matches the server
  const dark = mode === 'dark' || (mode === 'system' && systemDark);
  const palette = useMemo(() => (THEMES.find((t) => t.id === themeId) ?? THEMES[0])[dark ? 'dark' : 'light'], [themeId, dark]);

  /* ---- Hash routing ---- */
  useEffect(() => {
    const on = () => setPage(pageFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => { if (page === 'radar') setRadarSeen(true); }, [page]);
  const go = (id: PageId) => {
    setPage(id);
    if (window.location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`);
  };

  /* ---- Forecast loading ---- */
  const forecastsRef = useRef(forecasts);
  forecastsRef.current = forecasts;
  const load = useCallback(async (l: SavedLocation, force = false) => {
    const k = fcKey(l);
    const cur = forecastsRef.current[k];
    if (!force && cur && Date.now() - cur.fetchedAt < REFRESH_MS) return;
    setLoading(true);
    try {
      const r = await fetch(api(`forecast?lat=${l.lat.toFixed(2)}&lon=${l.lon.toFixed(2)}`));
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.now) throw new Error(j?.error || `Forecast request failed (${r.status}).`);
      const next: Cached = { data: j as ForecastResponse, fetchedAt: Date.now() };
      setForecasts((f) => ({ ...f, [k]: next }));
      store.set(`wx.fc.${k}`, next);
      setFetchError(null);
      // Name a geolocated place once NWS tells us where it is
      if (l.name === 'Current location' && next.data.meta.place) {
        setLocations((ls) => ls.map((x) => (x.id === l.id ? { ...x, name: next.data.meta.place! } : x)));
      }
    } catch (e) {
      setFetchError(navigator.onLine ? (e as Error).message : 'offline');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (ready) load(loc); }, [ready, loc, load]);

  // Refresh on focus when older than 10 minutes; re-render ages every minute
  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible') { load(loc); setNow(Date.now()); } };
    const net = () => { setOnline(navigator.onLine); if (navigator.onLine) load(loc, true); };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('online', net);
    window.addEventListener('offline', net);
    const t = setInterval(check, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', net);
      window.removeEventListener('offline', net);
      clearInterval(t);
    };
  }, [loc, load]);

  /* ---- Persist locations; keep the server's push copy in sync ---- */
  const firstLocSave = useRef(true);
  useEffect(() => {
    if (!ready) return;
    store.set('wx.locations', locations);
    store.set('wx.locIdx', locIdx);
    if (firstLocSave.current) { firstLocSave.current = false; return; }
    const keep = new Set(locations.map(fcKey));
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k?.startsWith('wx.fc.') && !keep.has(k.slice(6))) localStorage.removeItem(k);
      }
    } catch { /* storage blocked */ }
    syncPush(loadPushState(), locations).catch(() => { /* retried on next change */ });
  }, [ready, locations, locIdx]);

  const addLocation = (l: Omit<SavedLocation, 'id'>) => {
    setLocations((ls) => [...ls, { ...l, id: newLocId() }]);
    setLocIdx(locations.length);
    setSheet(null);
  };
  const removeLocation = (i: number) => {
    setLocations((ls) => ls.filter((_, k) => k !== i));
    setLocIdx((cur) => (i < cur ? cur - 1 : Math.min(cur, locations.length - 2)));
  };

  /* ---- Header copy ---- */
  const tz = data?.meta.tz ?? 'America/Chicago';
  const updatedMs = data ? Date.parse(data.meta.updated) : 0;
  const stale = data ? now - updatedMs > STALE_MS : false;
  const office = data?.meta.officeName ? `NWS ${data.meta.officeName}` : data?.meta.office ? `NWS ${data.meta.office}` : data ? 'Model data' : '';
  let sub = 'Loading forecast...';
  if (data) sub = `${stale ? 'Last updated' : 'Updated'} ${fmtTime(updatedMs, tz)} · ${office}`;
  else if (fetchError) sub = fetchError === 'offline' ? 'Offline · no saved forecast yet' : "Couldn't load the forecast";

  const banners: React.ReactNode[] = [];
  if (fetchError && data) {
    banners.push(
      <div key="fetch" className="banner warn" role="status">
        <span className="grow">
          {fetchError === 'offline' ? "You're offline." : "Couldn't reach Fairweather."} Showing the forecast from {fmtAge(data.meta.updated, now)}.
        </span>
        {fetchError !== 'offline' && <button className="banner-btn" onClick={() => load(loc, true)}>Retry</button>}
      </div>,
    );
  }
  for (const e of data?.meta.errors ?? []) banners.push(<div key={e} className="banner warn" role="status"><span className="grow">{e}</span></div>);


  return (
    <>
      <div className="fw">
        <header className="top">
          <button className="loc-btn" aria-haspopup="dialog" onClick={() => setSheet('locations')}>
            <span className="loc-name disp"><span>{loc.name}</span><ChevronDown /></span>
            <span className="loc-sub">{sub}</span>
          </button>
          <span className="spacer" />
          {!online && <span className="chip warn hide-sm">Offline</span>}
          {loading && !data && <span className="chip hide-sm">Loading</span>}
          <button className="icon-btn" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => {
            const m: Mode = dark ? 'light' : 'dark';
            setMode(m);
            store.set('wx.mode', m);
          }}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <button className="icon-btn" aria-label="Color themes" aria-haspopup="dialog" onClick={() => setSheet('theme')}><PaletteIcon /></button>
        </header>

        <main>
          {!data ? (
            <section className="page" aria-label="Loading" hidden={page === 'radar'}>
              {fetchError ? (
                <div className="banner warn" role="alert">
                  <span className="grow">
                    {fetchError === 'offline' ? "You're offline and there's no saved forecast for this place yet." : fetchError}
                  </span>
                  <button className="banner-btn" onClick={() => load(loc, true)}>Retry</button>
                </div>
              ) : (
                <div className="now" aria-busy="true">
                  <div className="skeleton hero" style={{ height: 300 }} />
                  {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 120 }} />)}
                </div>
              )}
            </section>
          ) : (
            <>
              <section className="page fit" aria-label="Now" hidden={page !== 'now'}>
                <NowPage data={data} banners={banners.length ? banners : null} now={now} />
              </section>
              <section className="page fit-lg" aria-label="Hourly" hidden={page !== 'hourly'}>
                <HourlyPage data={data} />
              </section>
              <section className="page ten-page" aria-label="10-day" hidden={page !== 'ten-day'}>
                {!data.meta.nwsOk && banners}
                <TenDayPage data={data} now={now} />
              </section>
            </>
          )}
          {radarSeen && (
            <RadarPage
              active={page === 'radar'} location={loc} locations={locations} locIdx={locIdx}
              radarSite={data?.meta.radarSite ?? null} tz={tz} accent={palette.accent}
            />
          )}
        </main>

        <nav className="tabs" aria-label="Pages">
          {PAGES.map((p) => (
            <button key={p.id} className="tab" aria-current={page === p.id ? 'page' : undefined} onClick={() => go(p.id)}>
              <span className="tab-ico">{TAB_ICONS[p.id]}</span>{p.label}
            </button>
          ))}
        </nav>
      </div>

      {sheet === 'locations' && (
        <LocationSheet
          locations={locations} locIdx={locIdx} pushOn={push.on}
          onSelect={(i) => { setLocIdx(i); setSheet(null); }}
          onAdd={addLocation} onRemove={removeLocation} onClose={() => setSheet(null)}
          onOpenNotifications={() => setSheet('notifications')} onOpenAbout={() => setSheet('about')}
        />
      )}
      {sheet === 'theme' && (
        <ThemeSheet
          themeId={themeId} mode={mode} onClose={() => setSheet(null)}
          onTheme={(id) => { setThemeId(id); store.set('wx.themeId', id); }}
          onMode={(m) => { setMode(m); store.set('wx.mode', m); }}
        />
      )}
      {sheet === 'notifications' && (
        <NotificationsSheet state={push} setState={setPush} locations={locations} onClose={() => setSheet('locations')} />
      )}
      {sheet === 'about' && <AboutSheet onClose={() => setSheet('locations')} />}
    </>
  );
}
