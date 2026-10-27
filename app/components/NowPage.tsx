'use client';

import { useState } from 'react';

import type { ForecastResponse, WxAlert } from '@/lib/types';

import { aqiInfo, degToCompass, dewComfort, fmtHour, fmtTime, fmtTimeTz, fmtWeekday, unwrap, uvLabel } from '../lib/format';
import { ChevronDown, WarnIcon, WxIcon } from './Icons';

function Compass({ deg }: { deg: number | null }) {
  const ticks = Array.from({ length: 36 }, (_, i) => {
    const major = i % 9 === 0;
    const r = major ? 27 : 30, a = (i * 10 * Math.PI) / 180;
    return (
      <line key={i} x1={38 + Math.sin(a) * r} y1={38 - Math.cos(a) * r} x2={38 + Math.sin(a) * 33} y2={38 - Math.cos(a) * 33}
        stroke="var(--fw-line)" strokeWidth={major ? 2 : 1} />
    );
  });
  let arrow = null;
  if (deg != null) {
    // Arrow points where the wind is going
    const a = ((deg + 180) * Math.PI) / 180;
    const tip = [38 + Math.sin(a) * 24, 38 - Math.cos(a) * 24], tail = [38 - Math.sin(a) * 24, 38 + Math.cos(a) * 24];
    arrow = (
      <>
        <line x1={tail[0]} y1={tail[1]} x2={tip[0]} y2={tip[1]} stroke="var(--fw-ink)" strokeWidth={2.4} strokeLinecap="round" />
        <circle cx={tail[0]} cy={tail[1]} r={3.4} fill="var(--fw-accent)" />
        <path
          d={`M${tip[0]} ${tip[1]} l${-Math.sin(a - 0.5) * 8} ${Math.cos(a - 0.5) * 8} M${tip[0]} ${tip[1]} l${-Math.sin(a + 0.5) * 8} ${Math.cos(a + 0.5) * 8}`}
          stroke="var(--fw-ink)" strokeWidth={2.4} strokeLinecap="round"
        />
      </>
    );
  }
  return (
    <svg className="compass" viewBox="0 0 76 76" aria-hidden="true">
      {ticks}
      <text x="38" y="14" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--fw-muted)">N</text>
      {arrow}
    </svg>
  );
}

function Sparkline({ vals, color }: { vals: number[]; color: string }) {
  if (vals.length < 2) return null;
  const w = 120, h = 40;
  const mn = Math.min(...vals), mx = Math.max(...vals), sx = w / (vals.length - 1);
  const pts = vals.map((v, i) => [i * sx, 4 + ((mx - v) / (mx - mn || 1)) * (h - 8)]);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="fill" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${w} ${h} L0 ${h}Z`} fill={color} fillOpacity=".12" stroke="none" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0] - 3} cy={last[1]} r="3" fill={color} />
    </svg>
  );
}

function SunArc({ sunrise, sunset, now }: { sunrise: string | null; sunset: string | null; now: number }) {
  const f = sunrise && sunset ? Math.max(0, Math.min(1, (now - Date.parse(sunrise)) / (Date.parse(sunset) - Date.parse(sunrise)))) : 0;
  const ang = Math.PI * (1 - f), cx = 60, cy = 50, r = 42;
  const sx = cx + Math.cos(ang) * r, sy = cy - Math.sin(ang) * r;
  return (
    <svg className="fill" viewBox="0 0 120 58" aria-hidden="true">
      <line x1="6" y1="50" x2="114" y2="50" stroke="var(--fw-line)" strokeWidth="1.5" />
      <path d="M18 50 A42 42 0 0 1 102 50" fill="none" stroke="var(--fw-sun)" strokeWidth="2" strokeDasharray="3 4" />
      <circle cx={sx} cy={sy + 6} r="5" fill="var(--fw-sun)" stroke="var(--fw-surface)" strokeWidth="2" />
    </svg>
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
  const rainMax = Math.max(0.01, ...n.rain24Hourly);
  const uvPos = n.uvPeak != null ? Math.min(11, n.uvPeak) / 11 : n.uv != null ? Math.min(11, n.uv) / 11 : 0;
  const aqi = n.aqi != null ? aqiInfo(n.aqi) : null;
  const trendArrow = n.pressureTrend === 'up' ? ' ↑' : n.pressureTrend === 'down' ? ' ↓' : n.pressureTrend === 'steady' ? ' →' : '';
  const hasBanners = alerts.length > 0 || !!banners;

  return (
    <div className={`now${hasBanners ? ' has-banners' : ''}`}>
      {hasBanners && (
        <div className="full" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {banners}
          {alerts.map((a) => <AlertBanner key={a.id} alert={a} tz={tz} />)}
        </div>
      )}

      <div className="tile hero">
        <div className="hero-row">
          <div>
            <div className="label">Right now</div>
            <div className="big-t disp num" style={{ marginTop: 8 }}>
              {n.temp ?? '--'}<sup>°F</sup>
            </div>
          </div>
          <WxIcon code={n.icon} night={!n.isDay} className="hero-ico" />
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
        <div className="compass-wrap">
          <Compass deg={n.windSpeed ? n.windDeg : null} />
          <div>
            <div className="val disp num">{n.windSpeed ?? '--'}<small>mph</small></div>
            <div className="note">
              {!n.windSpeed || n.windDeg == null ? 'Calm' : degToCompass(n.windDeg)}
              {n.windGust && n.windGust >= 10 && n.windGust >= (n.windSpeed ?? 0) + 5 ? ` · gusts ${n.windGust}` : ''}
            </div>
          </div>
        </div>
      </div>

      <div className="tile">
        <div className="label">Humidity</div>
        <div className="val disp num">{n.humidity ?? '--'}<small>%</small></div>
        {n.dewPoint != null && <div className="note">Dew point <b className="num">{n.dewPoint}°</b>. {dewComfort(n.dewPoint)}</div>}
      </div>

      <div className="tile">
        <div className="label">Pressure</div>
        <div className="val disp num">{n.pressure?.toFixed(2) ?? '--'}<small>inHg{trendArrow}</small></div>
        <Sparkline vals={n.pressure24} color="var(--fw-cool)" />
        <div className="axis"><span>24h ago</span><span>now</span></div>
      </div>

      <div className="tile">
        <div className="label">UV index</div>
        <div className="val disp num">{n.uv ?? '--'}<small>now</small></div>
        <div className="uvbar"><i style={{ left: `${uvPos * 100}%` }} /></div>
        {n.uvPeak != null && (
          <div className="note">
            Peaks at {n.uvPeak}, {uvLabel(n.uvPeak)}{n.uvPeakTime ? `, around ${fmtHour(n.uvPeakTime, tz)}` : ''}.
          </div>
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
      </div>

      <div className="tile">
        <div className="label">Air quality</div>
        <div className="val disp num" style={{ color: aqi?.color }}>{n.aqi ?? '--'}</div>
        <div className="note">
          {aqi ? `${aqi.label}.${n.aqiPollutant ? ` Main pollutant ${n.aqiPollutant}.` : ''}` : 'Air quality unavailable right now.'}
        </div>
      </div>

      <div className="tile">
        <div className="label">Rain, past 24 h</div>
        <div className="val disp num">{n.rain24.toFixed(2)}<small>in</small></div>
        <div className="bars" role="img" aria-label={`Rain over the past 24 hours, ${n.rain24.toFixed(2)} inches total`}>
          {n.rain24Hourly.map((v, i) => (
            <i key={i} className={v ? '' : 'zero'} style={{ height: `${v ? Math.max(8, (v / rainMax) * 100) : 6}%` }} />
          ))}
        </div>
        <div className="axis">
          <span>{fmtHour(n.rain24Start, tz)} {fmtWeekday(n.rain24Start, tz)}</span><span>now</span>
        </div>
      </div>
    </div>
  );
}
