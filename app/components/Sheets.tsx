'use client';

import { useEffect, useRef, useState } from 'react';

import type { AlertMin, PushPrefs, SavedLocation } from '@/lib/types';

import { api } from '../lib/base';
import {
  type PushState, type PushSupport, disablePush, enablePush, pushSupport, savePushState, sendTestPush, syncPush,
} from '../lib/push';
import { THEMES, type Mode, effectiveMode } from '../lib/theme';
import { BellIcon, ChevronRight, CloseIcon, InfoIcon, PinIcon } from './Icons';

/* ------------------------------------------------------------------ */
/*  Sheet shell: bottom sheet on phones, centered dialog on desktop    */
/* ------------------------------------------------------------------ */

export function Sheet({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const titleId = `fw-sheet-${title.replace(/\W+/g, '-').toLowerCase()}`;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, []);
  return (
    <div className="fw-layer scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`sheet${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sheet-head">
          <h2 id={titleId} className="disp">{title}</h2>
          <button className="fw-btn ghost" onClick={onClose}>Done</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Locations                                                          */
/* ------------------------------------------------------------------ */

const PRESETS = [
  { name: 'Kansas City, MO', lat: 39.0997, lon: -94.5786 },
  { name: 'Overland Park, KS', lat: 38.9822, lon: -94.6708 },
  { name: "Lee's Summit, MO", lat: 38.9108, lon: -94.3822 },
  { name: 'Liberty, MO', lat: 39.2461, lon: -94.4191 },
  { name: 'Lawrence, KS', lat: 38.9717, lon: -95.2353 },
  { name: 'Denver, CO', lat: 39.7392, lon: -104.9903 },
];

export const newLocId = () => Math.random().toString(36).slice(2, 10);

interface LocationSheetProps {
  locations: SavedLocation[];
  locIdx: number;
  onSelect: (i: number) => void;
  onAdd: (l: Omit<SavedLocation, 'id'>) => void;
  onRemove: (i: number) => void;
  onClose: () => void;
  onOpenNotifications: () => void;
  onOpenAbout: () => void;
  pushOn: boolean;
}

export function LocationSheet(p: LocationSheetProps) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ name: string; lat: number; lon: number }[]>([]);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [manual, setManual] = useState({ name: '', lat: '', lon: '' });
  const [manualErr, setManualErr] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setSearchErr(null); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(api(`geocode?q=${encodeURIComponent(q.trim())}`), { signal: ctl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setResults(j.results);
        setSearchErr(j.results.length ? null : 'No US places match. Try "City, ST".');
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setSearchErr((e as Error).message || "Couldn't reach place search.");
      }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setGeoErr("This browser can't share its location. Search or enter coordinates instead."); return; }
    setLocating(true);
    setGeoErr(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        p.onAdd({ name: 'Current location', lat: Math.round(pos.coords.latitude * 1e4) / 1e4, lon: Math.round(pos.coords.longitude * 1e4) / 1e4 });
      },
      (err) => {
        setLocating(false);
        setGeoErr(err.code === err.PERMISSION_DENIED ? 'Location access was denied. Search or enter coordinates instead.' : "Couldn't get your location. Try again or search instead.");
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(manual.lat), lon = parseFloat(manual.lon);
    if (!manual.name.trim() || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) {
      setManualErr('Use decimal degrees, like 39.0997 and -94.5786.');
      return;
    }
    setManualErr(null);
    p.onAdd({ name: manual.name.trim(), lat, lon });
    setManual({ name: '', lat: '', lon: '' });
  };

  const presets = PRESETS.filter((x) => !p.locations.some((l) => l.name === x.name));

  return (
    <Sheet title="Locations" onClose={p.onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {p.locations.map((l, i) => (
          <div key={l.id} className={`locrow${i === p.locIdx ? ' on' : ''}`}>
            <button className="pick" onClick={() => p.onSelect(i)}>
              <b>{l.name}</b>
              <span>{l.lat.toFixed(4)}, {l.lon.toFixed(4)}{p.pushOn && i === 0 ? ' · primary' : ''}</span>
            </button>
            {p.locations.length > 1 && (
              <button className="rm" aria-label={`Remove ${l.name}`} onClick={() => p.onRemove(i)}><CloseIcon /></button>
            )}
          </div>
        ))}
      </div>

      <div className="label">Add a location</div>
      <input
        className="fw-input" type="search" placeholder="Search US places, e.g. Olathe, KS" value={q}
        onChange={(e) => setQ(e.target.value)} aria-label="Search places" autoComplete="off"
      />
      {results.length > 0 && (
        <div className="results">
          {results.map((r) => (
            <button key={`${r.lat},${r.lon}`} onClick={() => { p.onAdd(r); setQ(''); }}>
              <b>{r.name}</b><span>{r.lat.toFixed(2)}, {r.lon.toFixed(2)}</span>
            </button>
          ))}
        </div>
      )}
      {searchErr && <p className="fine">{searchErr}</p>}
      <button className="menurow" onClick={useMyLocation} disabled={locating}>
        <PinIcon /><span className="grow">{locating ? 'Finding you...' : 'Use my location'}</span>
      </button>
      {geoErr && <p className="err-text">{geoErr}</p>}
      {presets.length > 0 && (
        <div className="presets">
          {presets.map((x) => <button key={x.name} onClick={() => p.onAdd(x)}>+ {x.name}</button>)}
        </div>
      )}
      <form className="fw-form" onSubmit={submitManual}>
        <input className="fw-input full" placeholder="Name, e.g. Mom's house" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} aria-label="Location name" />
        <input className="fw-input" placeholder="Latitude" inputMode="decimal" value={manual.lat} onChange={(e) => setManual({ ...manual, lat: e.target.value })} aria-label="Latitude" />
        <input className="fw-input" placeholder="Longitude" inputMode="decimal" value={manual.lon} onChange={(e) => setManual({ ...manual, lon: e.target.value })} aria-label="Longitude" />
        <button className="fw-btn full" type="submit">Save location</button>
      </form>
      {manualErr && <p className="err-text">{manualErr}</p>}

      <button className="menurow" onClick={p.onOpenNotifications}>
        <BellIcon />
        <span className="grow">Notifications<small>{p.pushOn ? 'On' : 'Off'} · alerts, rain soon, morning brief</small></span>
        <ChevronRight />
      </button>
      <button className="menurow" onClick={p.onOpenAbout}>
        <InfoIcon /><span className="grow">About and data sources</span><ChevronRight />
      </button>
      <p className="fine">Saved in this browser only. No account, no sync.</p>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Theme                                                              */
/* ------------------------------------------------------------------ */

export function ThemeSheet({ themeId, mode, onTheme, onMode, onClose }: {
  themeId: string; mode: Mode; onTheme: (id: string) => void; onMode: (m: Mode) => void; onClose: () => void;
}) {
  const m = effectiveMode(mode);
  return (
    <Sheet title="Theme" onClose={onClose} wide>
      <div className="mode-seg" role="group" aria-label="Appearance">
        {([['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']] as const).map(([k, l]) => (
          <button key={k} aria-pressed={mode === k} onClick={() => onMode(k)}>{l}</button>
        ))}
      </div>
      <div className="label">Kansas City palettes</div>
      <div className="themes">
        {THEMES.map((t) => {
          const c = t[m];
          return (
            <button key={t.id} className="theme" aria-pressed={t.id === themeId} onClick={() => onTheme(t.id)}>
              <span className="prev" style={{ background: `linear-gradient(160deg,${c.heroA},${c.heroB})` }}>
                <b className="disp" style={{ color: c.ink }}>46°</b>
                <i style={{ background: c.accent }} /><i style={{ background: c.cool }} /><i style={{ background: c.surface }} /><i style={{ background: c.ink }} />
              </span>
              <span className="tn">{t.name}</span>
              <span className="ts">{t.inspiredBy}</span>
            </button>
          );
        })}
      </div>
      <p className="fine">Saved in this browser. Radar basemap style is set separately on the Radar page.</p>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Notifications                                                      */
/* ------------------------------------------------------------------ */

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button className="switch" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} />;
}

export function NotificationsSheet({ state, setState, locations, onClose }: {
  state: PushState; setState: (s: PushState) => void; locations: SavedLocation[]; onClose: () => void;
}) {
  const [support] = useState<PushSupport>(() => pushSupport());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try { await fn(); } catch (e) { setMsg({ text: (e as Error).message, err: true }); } finally { setBusy(false); }
  };

  const toggle = (on: boolean) => run(async () => {
    setState(on ? await enablePush(locations, state.prefs) : await disablePush(state));
  });

  const setPref = (patch: Partial<PushPrefs>) => {
    const next = { ...state, prefs: { ...state.prefs, ...patch } };
    setState(next);
    savePushState(next);
    if (next.on) syncPush(next, locations).catch((e: Error) => setMsg({ text: `Couldn't save to the server: ${e.message}`, err: true }));
  };

  const p = state.prefs;
  return (
    <Sheet title="Notifications" onClose={onClose}>
      {support === 'ios-install' ? (
        <div className="banner">
          <div className="grow">
            <b>Add Fairweather to your Home Screen first.</b> On iPhone and iPad, notifications only work in the installed app (iOS 16.4 or later).
            Tap the Share button, choose <b>Add to Home Screen</b>, then open Fairweather from there and come back here.
          </div>
        </div>
      ) : support === 'unsupported' ? (
        <p className="note">This browser doesn&apos;t support web notifications.</p>
      ) : (
        <>
          <div className="setting">
            <div><b>Notifications</b><small>Alerts, rain soon, and a morning brief for your saved places</small></div>
            <Switch checked={state.on} onChange={toggle} label="Notifications" disabled={busy} />
          </div>
          <div className="setting">
            <div><b>NWS alerts</b><small>Any saved location</small></div>
            <select className="fw-select" value={p.alertMin} onChange={(e) => setPref({ alertMin: e.target.value as AlertMin })} aria-label="Alert threshold">
              <option value="advisory">Advisories and up</option>
              <option value="watch">Watches and up</option>
              <option value="warning">Warnings only</option>
            </select>
          </div>
          <div className="setting">
            <div><b>Rain soon</b><small>{locations[0]?.name ?? 'Primary location'} · next 60 minutes</small></div>
            <Switch checked={p.rainSoon} onChange={(v) => setPref({ rainSoon: v })} label="Rain soon" />
          </div>
          <div className="setting">
            <div><b>Morning brief</b><small>High, low, rain chance, and alerts</small></div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {p.briefTime && (
                <input className="fw-input" type="time" value={p.briefTime} onChange={(e) => setPref({ briefTime: e.target.value || null })} aria-label="Brief time" />
              )}
              <Switch checked={!!p.briefTime} onChange={(v) => setPref({ briefTime: v ? '06:30' : null })} label="Morning brief" />
            </div>
          </div>
          <div className="setting">
            <div><b>Quiet hours</b><small>Held until morning, except severe warnings</small></div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input className="fw-input" type="time" value={p.quietStart} onChange={(e) => e.target.value && setPref({ quietStart: e.target.value })} aria-label="Quiet hours start" />
              <span className="note">to</span>
              <input className="fw-input" type="time" value={p.quietEnd} onChange={(e) => e.target.value && setPref({ quietEnd: e.target.value })} aria-label="Quiet hours end" />
            </div>
          </div>
          <button className="fw-btn ghost" disabled={!state.on || busy} onClick={() => run(async () => { await sendTestPush(state); setMsg({ text: 'Test sent. It should arrive in a few seconds.' }); })}>
            Send test
          </button>
          {msg && <p className={msg.err ? 'err-text' : 'fine'} role="status">{msg.text}</p>}
          <p className="fine">No account. This browser&apos;s push subscription is its only identity, and turning this off deletes it from the server.</p>
        </>
      )}
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  About                                                              */
/* ------------------------------------------------------------------ */

export function AboutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="About" onClose={onClose}>
      <p>
        Fairweather is a personal, ad-free weather app for Kansas City and anywhere else in the contiguous US. No login, no tracking.
        Locations and settings stay in this browser.
      </p>
      <div className="label">How the forecast is built</div>
      <ul className="credits">
        <li>Now: the nearest NWS ASOS station reports under an hour old, else model data.</li>
        <li>Hourly: a blend of the NWS forecast grid, NBM, HRRR, and ECMWF, nudged toward the latest observation.</li>
        <li>Days 1 to 7: NWS forecast text, unedited. Days 8 to 10: the mean of ECMWF, GFS, and ICON.</li>
        <li>Alerts: NWS, as issued.</li>
      </ul>
      <div className="label">Data and credits</div>
      <ul className="credits">
        <li>NOAA / National Weather Service: forecasts, observations, alerts</li>
        <li>NOAA HRRR and NBM, ECMWF, DWD ICON, and NOAA GFS model data via <a href="https://open-meteo.com" target="_blank" rel="noreferrer">Open-Meteo</a></li>
        <li>NOAA NEXRAD composite and HRRR radar tiles via the <a href="https://mesonet.agron.iastate.edu" target="_blank" rel="noreferrer">Iowa Environmental Mesonet</a></li>
        <li>Air quality: EPA AirNow when available, else CAMS via Open-Meteo</li>
        <li>Basemaps: <a href="https://www.mapbox.com" target="_blank" rel="noreferrer">Mapbox</a> and OpenStreetMap contributors</li>
      </ul>
      <p className="fine">Model forecasts are guidance, not observations. For life-safety decisions, follow official NWS warnings.</p>
    </Sheet>
  );
}
