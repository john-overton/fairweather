import { useEffect, useId, useRef, useState } from 'react';

import type { Cond, ForecastResponse, WxAlert } from '@/lib/types';

import { aqiInfo, degToCompass, dewComfort, fmtHour, fmtTime, fmtTimeTz, fmtWeekday, unwrap, uvLabel } from '../lib/format';
import HeroIcon from './HeroIcon';
import HeroSky from './HeroSky';
import { ChevronDown, WarnIcon, WxIcon } from './Icons';

const HOUR = 3600_000;

/** Tracks an element's content box, so charts draw in real pixels: no stretched dots, and they fill the tile. */
function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height);
      setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

/** Flexible chart area: grows to fill whatever height the tile has left. */
function Plot({ label, className, children }: { label?: string; className?: string; children: (w: number, h: number) => React.ReactNode }) {
  const [ref, { w, h }] = useBox<HTMLDivElement>();
  return (
    <div ref={ref} className={`plot${className ? ` ${className}` : ''}`} role={label ? 'img' : undefined} aria-label={label}>
      {w > 0 && h > 0 && <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">{children(w, h)}</svg>}
    </div>
  );
}

const DOT = 4;

/** Line + area for an hourly series, with a dot on the latest value. `minSpan` keeps tiny wiggles from filling the height. */
function LineChart({ vals, color, domain, minSpan = 0, label }: {
  vals: number[]; color: string; domain?: [number, number]; minSpan?: number; label: string;
}) {
  if (vals.length < 2) return null;
  let [lo, hi] = domain ?? [Math.min(...vals), Math.max(...vals)];
  if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
  return (
    <Plot label={label}>
      {(w, h) => {
        const top = DOT + 3, bot = 2, x1 = w - DOT - 2;
        const pts = vals.map((v, i) => [(i / (vals.length - 1)) * x1, top + (1 - (v - lo) / (hi - lo || 1)) * (h - top - bot)]);
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
        const [lx, ly] = pts[pts.length - 1];
        return (
          <>
            <path d={`${d} L${lx.toFixed(1)} ${h} L0 ${h}Z`} fill={color} fillOpacity=".12" />
            <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={lx} cy={ly} r={DOT} fill={color} stroke="var(--fw-surface)" strokeWidth="2" />
          </>
        );
      }}
    </Plot>
  );
}

function Compass({ deg }: { deg: number | null }) {
  return (
    <Plot className="compass">
      {(w, h) => {
        const R = Math.min(w, h) / 2 - 1, cx = w / 2, cy = h / 2;
        const at = (a: number, r: number) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
        const ticks = Array.from({ length: 36 }, (_, i) => {
          const major = i % 9 === 0, a = (i * 10 * Math.PI) / 180;
          const [x1, y1] = at(a, R * (major ? 0.8 : 0.88)), [x2, y2] = at(a, R);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--fw-line)" strokeWidth={major ? 2 : 1} />;
        });
        const font = Math.max(8, Math.min(13, R * 0.2));
        let arrow = null;
        if (deg != null) {
          // Arrow points where the wind is going
          const a = ((deg + 180) * Math.PI) / 180, len = R * 0.52, head = Math.max(7, R * 0.2), sw = Math.max(2.4, R * 0.045);
          const [tx, ty] = at(a, len), [bx, by] = at(a + Math.PI, len);
          arrow = (
            <g stroke="var(--fw-ink)" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" fill="none">
              <line x1={bx} y1={by} x2={tx} y2={ty} />
              <path d={`M${tx - Math.sin(a - 0.5) * head} ${ty + Math.cos(a - 0.5) * head} L${tx} ${ty} L${tx - Math.sin(a + 0.5) * head} ${ty + Math.cos(a + 0.5) * head}`} />
              <circle cx={bx} cy={by} r={sw * 1.4} fill="var(--fw-accent)" stroke="none" />
            </g>
          );
        }
        return (
          <>
            {ticks}
            <text x={cx} y={cy - R * 0.68} textAnchor="middle" dominantBaseline="middle" fontSize={font} fontWeight="700" fill="var(--fw-muted)">N</text>
            {arrow}
          </>
        );
      }}
    </Plot>
  );
}

function SunArc({ sunrise, sunset, now }: { sunrise: string | null; sunset: string | null; now: number }) {
  const rise = sunrise ? Date.parse(sunrise) : NaN, set = sunset ? Date.parse(sunset) : NaN;
  const up = now >= rise && now <= set;
  const f = Number.isFinite(rise) && Number.isFinite(set) ? Math.max(0, Math.min(1, (now - rise) / (set - rise))) : 0;
  return (
    <Plot>
      {(w, h) => {
        const core = 6, rays = core + 8, cy = h - 6, cx = w / 2;
        const R = Math.max(12, Math.min(w / 2 - rays, cy - rays));
        const ang = Math.PI * (1 - f), sx = cx + Math.cos(ang) * R, sy = cy - Math.sin(ang) * R;
        return (
          <>
            <line x1="0" y1={cy} x2={w} y2={cy} stroke="var(--fw-line)" strokeWidth="1.5" />
            <path d={`M${cx - R} ${cy} A${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke="var(--fw-sun)" strokeWidth="2" strokeDasharray="3 5" strokeOpacity=".7" />
            {f > 0 && <path d={`M${cx - R} ${cy} A${R} ${R} 0 0 1 ${sx} ${sy}`} fill="none" stroke="var(--fw-sun)" strokeWidth="2.5" strokeLinecap="round" />}
            <g opacity={up ? 1 : 0.45}>
              <circle cx={sx} cy={sy} r={rays + 1} fill="var(--fw-surface)" />
              <circle cx={sx} cy={sy} r={core} fill="var(--fw-sun)" />
              {Array.from({ length: 8 }, (_, i) => {
                const a = (i * Math.PI) / 4;
                return (
                  <line key={i} x1={sx + Math.cos(a) * (core + 3)} y1={sy + Math.sin(a) * (core + 3)}
                    x2={sx + Math.cos(a) * rays} y2={sy + Math.sin(a) * rays} stroke="var(--fw-sun)" strokeWidth="2" strokeLinecap="round" />
                );
              })}
            </g>
          </>
        );
      }}
    </Plot>
  );
}

/** EPA UV colors by index value, matching the old UV bar */
const UV_STOPS: [number, string][] = [[0, '#3ea55a'], [2.75, '#e4cc3a'], [6, '#f08a24'], [8.25, '#d93a2b'], [11, '#8d3fbf']];

/** Today's UV curve, colored by UV level, with a marker at now */
function UvChart({ vals, start, now, label }: { vals: number[]; start: number; now: number; label: string }) {
  const id = useId();
  const hi = Math.max(4, ...vals) * 1.08, n = vals.length;
  const pos = Math.max(0, Math.min(n - 1, (now - start) / HOUR));
  const k = Math.min(n - 2, Math.floor(pos));
  const vNow = vals[k] + (vals[k + 1] - vals[k]) * (pos - k);
  return (
    <Plot label={label}>
      {(w, h) => {
        const top = 9, bot = 2, pad = 9;
        const x = (i: number) => pad + (i / (n - 1)) * (w - 2 * pad);
        const y = (v: number) => top + (1 - v / hi) * (h - top - bot);
        const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
        return (
          <>
            <defs>
              <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1={y(0)} x2="0" y2={y(11)}>
                {UV_STOPS.map(([v, c]) => <stop key={v} offset={v / 11} stopColor={c} />)}
              </linearGradient>
            </defs>
            <path d={`${d} L${x(n - 1)} ${h} L${x(0)} ${h}Z`} fill={`url(#${id})`} fillOpacity=".22" />
            <path d={d} fill="none" stroke={`url(#${id})`} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={x(pos)} cy={y(vNow)} r="5.5" fill="var(--fw-surface)" stroke="var(--fw-ink)" strokeWidth="3" />
          </>
        );
      }}
    </Plot>
  );
}

/** EPA AQI categories: upper bound and color */
const AQI_BANDS: [number, string][] = [[50, 'var(--fw-good)'], [100, 'var(--fw-warn)'], [150, '#e0702b'], [200, 'var(--fw-bad)'], [300, '#8f3f97'], [500, '#7e0023']];

/** Half-circle AQI gauge, one equal segment per EPA category, with a marker at the reading */
function AqiGauge({ aqi }: { aqi: number | null }) {
  return (
    <Plot>
      {(w, h) => {
        const base = Math.min(w / 2, h) - 2;
        const sw = Math.max(6, Math.min(14, base * 0.13)), knob = sw / 2 + 3;
        const R = base - knob, cx = w / 2, cy = h - knob - 1;
        const pt = (t: number) => [cx - Math.cos(Math.PI * t) * R, cy - Math.sin(Math.PI * t) * R];
        const seg = 1 / AQI_BANDS.length, gap = 0.012;
        let t: number | null = null;
        if (aqi != null) {
          const k = AQI_BANDS.findIndex(([max]) => aqi <= max);
          const i = k < 0 ? AQI_BANDS.length - 1 : k, lo = i ? AQI_BANDS[i - 1][0] : 0;
          t = Math.min(1, (i + Math.min(1, (aqi - lo) / (AQI_BANDS[i][0] - lo))) * seg);
        }
        return (
          <>
            {AQI_BANDS.map(([, c], i) => {
              const [ax, ay] = pt(i * seg + (i ? gap : 0)), [bx, by] = pt((i + 1) * seg - (i < AQI_BANDS.length - 1 ? gap : 0));
              return <path key={i} d={`M${ax} ${ay} A${R} ${R} 0 0 1 ${bx} ${by}`} fill="none" stroke={aqi == null ? 'var(--fw-line)' : c} strokeWidth={sw} opacity={aqi == null ? 1 : 0.85} />;
            })}
            {t != null && (() => { const [kx, ky] = pt(t); return <circle cx={kx} cy={ky} r={knob} fill="var(--fw-surface)" stroke="var(--fw-ink)" strokeWidth="3" />; })()}
          </>
        );
      }}
    </Plot>
  );
}

function RainBars({ vals, label }: { vals: number[]; label: string }) {
  const max = Math.max(0.01, ...vals);
  return (
    <Plot label={label}>
      {(w, h) => {
        const gap = 2, bw = (w - gap * (vals.length - 1)) / vals.length;
        return vals.map((v, i) => {
          const bh = v ? Math.max(h * 0.08, (v / max) * h) : Math.min(4, Math.max(2, h * 0.06));
          return <rect key={i} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={Math.min(2, bw / 2)}
            fill={v ? 'var(--fw-cool)' : 'var(--fw-line)'} fillOpacity={v ? 0.85 : 1} />;
        });
      }}
    </Plot>
  );
}

function AlertBanner({ alert, tz }: { alert: WxAlert; tz: string }) {
  const [open, setOpen] = useState(false);
  const until = alert.ends ?? alert.expires;
  return (
    <button className="wx-alert" aria-expanded={open} onClick={() => setOpen(!open)}>
      <WarnIcon />
      <span>
        <span className="a-title">{alert.event}</span><br />
        <span className="a-sub">
          {until ? `Until ${fmtTimeTz(until, tz)} · ` : ''}{alert.office ? `NWS ${alert.office}` : alert.senderName}
        </span>
      </span>
      <ChevronDown size={18} rotate={open ? 180 : 0} />
      {open && (
        <span className="alert-body">
          {alert.headline && <b>{alert.headline}</b>}
          {unwrap(alert.description).map((p, i) => <span key={i}>{p}</span>)}
          {alert.instruction && unwrap(alert.instruction).map((p, i) => <span key={`i${i}`}>{p}</span>)}
        </span>
      )}
    </button>
  );
}

export default function NowPage({ data, banners, now }: { data: ForecastResponse; banners: React.ReactNode; now: number }) {
  const { now: n, hourly, meta, alerts } = data;
  const tz = meta.tz;
  const strip = [0, 2, 4, 6, 8, 10].map((i) => hourly[i]).filter(Boolean);
  const uvPos = n.uvPeak != null ? Math.min(11, n.uvPeak) / 11 : n.uv != null ? Math.min(11, n.uv) / 11 : 0;
  // Older cached forecasts predate these series
  const uvDay = n.uvDay ?? [], uvStart = n.uvDayStart ? Date.parse(n.uvDayStart) : NaN;
  /** Model history, ending on the reading the tile shows */
  const ending = (vals: number[] | undefined, cur: number | null) => (vals?.length ? (cur == null ? vals : [...vals.slice(0, -1), cur]) : []);
  const past24 = <div className="axis"><span>24h ago</span><span>now</span></div>;
  const aqi = n.aqi != null ? aqiInfo(n.aqi) : null;
  const trendArrow = n.pressureTrend === 'up' ? ' ↑' : n.pressureTrend === 'down' ? ' ↓' : n.pressureTrend === 'steady' ? ' →' : '';
  const hasBanners = alerts.length > 0 || !!banners;
  // Dev only: ?wx=rain&night=1 previews the hero for any condition
  const preview = import.meta.env.DEV && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const heroCode = (preview?.get('wx') as Cond | null) ?? n.icon;
  const heroNight = preview?.has('night') ? preview.get('night') === '1' : !n.isDay;

  return (
    <div className={`now${hasBanners ? ' has-banners' : ''}`}>
      {hasBanners && (
        <div className="full" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {banners}
          {alerts.map((a) => <AlertBanner key={a.id} alert={a} tz={tz} />)}
        </div>
      )}

      <div className="tile hero">
        <HeroSky code={heroCode} night={heroNight} />
        <div className="hero-row">
          <div>
            <div className="label">Right now</div>
            <div className="big-t disp num" style={{ marginTop: 8 }}>
              {n.temp ?? '--'}<sup>°F</sup>
            </div>
          </div>
          <HeroIcon code={heroCode} night={heroNight} />
        </div>
        <div className="cond">{n.condition}</div>
        <div className="hero-meta">
          {n.feelsLike != null && <span>Feels like <b className="num">{n.feelsLike}°</b></span>}
          {n.high != null && <span>High <b className="num">{n.high}°</b></span>}
          {n.low != null && <span>Low <b className="num">{n.low}°</b></span>}
        </div>
        <div className="src-note">
          {n.source === 'ASOS' ? `Observed ${fmtTime(n.observedAt, tz)} · ${n.station}` : 'Model estimate · no recent station report'}
        </div>
        <div className="mini-strip">
          {strip.map((h, k) => (
            <div key={h.time}>
              <span>{k === 0 ? 'Now' : fmtHour(h.time, tz).replace(':00', '')}</span>
              <WxIcon code={h.icon} night={!h.isDay} />
              <b className="num">{h.temp}°</b>
            </div>
          ))}
        </div>
      </div>

      <div className="tile">
        <div className="label">Wind</div>
        <div className="val disp num">{n.windSpeed ?? '--'}<small>mph</small></div>
        <div className="note">
          {!n.windSpeed || n.windDeg == null ? 'Calm' : degToCompass(n.windDeg)}
          {n.windGust && n.windGust >= 10 && n.windGust >= (n.windSpeed ?? 0) + 5 ? ` · gusts ${n.windGust}` : ''}
        </div>
        <Compass deg={n.windSpeed ? n.windDeg : null} />
      </div>

      <div className="tile">
        <div className="label">Humidity</div>
        <div className="val disp num">{n.humidity ?? '--'}<small>%</small></div>
        {n.dewPoint != null && <div className="note">Dew point <b className="num">{n.dewPoint}°</b>. {dewComfort(n.dewPoint)}</div>}
        <LineChart vals={ending(n.humidity24, n.humidity)} domain={[0, 100]} color="var(--fw-cool)" label="Humidity over the past 24 hours" />
        {!!n.humidity24?.length && past24}
      </div>

      <div className="tile">
        <div className="label">Pressure</div>
        <div className="val disp num">{n.pressure?.toFixed(2) ?? '--'}<small>inHg{trendArrow}</small></div>
        <LineChart vals={ending(n.pressure24, n.pressure)} minSpan={0.12} color="var(--fw-cool)" label="Pressure over the past 24 hours" />
        {past24}
      </div>

      <div className="tile">
        <div className="label">UV index</div>
        <div className="val disp num">{n.uv ?? '--'}<small>now</small></div>
        {n.uvPeak != null && (
          <div className="note">
            Peaks at {n.uvPeak}, {uvLabel(n.uvPeak)}{n.uvPeakTime ? `, around ${fmtHour(n.uvPeakTime, tz)}` : ''}.
          </div>
        )}
        {uvDay.length >= 2 && Number.isFinite(uvStart) ? (
          <>
            <UvChart vals={uvDay} start={uvStart} now={now} label="UV index through today" />
            <div className="axis"><span>{fmtHour(uvStart, tz)}</span><span>{fmtHour(uvStart + (uvDay.length - 1) * HOUR, tz)}</span></div>
          </>
        ) : (
          <div className="uvbar"><i style={{ left: `${uvPos * 100}%` }} /></div>
        )}
      </div>

      <div className="tile">
        <div className="label">Sun</div>
        <SunArc sunrise={n.sunrise} sunset={n.sunset} now={now} />
        <div className="axis">
          <span>↑ {n.sunrise ? fmtTime(n.sunrise, tz) : '--'}</span>
          <span>↓ {n.sunset ? fmtTime(n.sunset, tz) : '--'}</span>
        </div>
      </div>

      <div className="tile">
        <div className="label">Visibility</div>
        <div className="val disp num">{n.visibility ?? '--'}<small>mi</small></div>
        {n.cloudCover != null && <div className="note">Clouds {n.cloudCover}%.</div>}
        <LineChart vals={ending(n.visibility24, n.visibility)} domain={[0, 10]} color="var(--fw-cool)" label="Visibility over the past 24 hours" />
        {!!n.visibility24?.length && past24}
      </div>

      <div className="tile">
        <div className="label">Air quality</div>
        <div className="val disp num" style={{ color: aqi?.color }}>{n.aqi ?? '--'}</div>
        <div className="note">
          {aqi ? `${aqi.label}.${n.aqiPollutant ? ` Main pollutant ${n.aqiPollutant}.` : ''}` : 'Air quality unavailable right now.'}
        </div>
        <AqiGauge aqi={n.aqi} />
      </div>

      <div className="tile">
        <div className="label">Rain, past 24 h</div>
        <div className="val disp num">{n.rain24.toFixed(2)}<small>in</small></div>
        <RainBars vals={n.rain24Hourly} label={`Rain over the past 24 hours, ${n.rain24.toFixed(2)} inches total`} />
        <div className="axis">
          <span>{fmtHour(n.rain24Start, tz)} {fmtWeekday(n.rain24Start, tz)}</span><span>now</span>
        </div>
      </div>
    </div>
  );
}
