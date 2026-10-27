'use client';

import { Fragment, useEffect, useRef, useState } from 'react';

import type { ForecastResponse, HourData } from '@/lib/types';

import { fmtHour, fmtHourShort, fmtLongDate, fmtTime, localDate } from '../lib/format';
import { WxIcon } from './Icons';

const HOUR = 3600_000;

function HourlyChart({ hours, tz, sunrise, sunset }: { hours: HourData[]; tz: string; sunrise: string | null; sunset: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = hours.length;
  if (n < 2) return <div ref={box} />;
  const h = 210, pl = 14, pr = 14, top = 28, cb = 148, pb = 170;
  const T = hours.map((x) => x.temp);
  const mn = Math.min(...T) - 2, mx = Math.max(...T) + 2;
  const x = (i: number) => pl + (i * (w - pl - pr)) / (n - 1);
  const y = (v: number) => top + ((mx - v) / (mx - mn)) * (cb - top);
  const d = T.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const step = w < 520 ? 4 : 3;
  const t0 = Date.parse(hours[0].time);

  // Sun markers inside the window (tomorrow's times approximated as today's + 24 h)
  const markers: { at: number; label: string }[] = [];
  for (const [iso, name] of [[sunrise, 'Sunrise'], [sunset, 'Sunset']] as const) {
    if (!iso) continue;
    for (const off of [0, 24 * HOUR]) {
      const at = Date.parse(iso) + off;
      const fx = (at - t0) / HOUR;
      if (fx > 0.3 && fx < n - 1) markers.push({ at: fx, label: `${name} ${fmtTime(at, tz).replace(/ [AP]M/, '')}` });
    }
  }

  const hi = hours.reduce((a, b) => (b.temp > a.temp ? b : a));
  const lo = hours.reduce((a, b) => (b.temp < a.temp ? b : a));
  const wet = hours.filter((x2) => x2.pop >= 20).length;
  const aria = `Temperature and rain chance, next ${n} hours. High ${hi.temp}° around ${fmtHour(hi.time, tz)}, low ${lo.temp}° around ${fmtHour(lo.time, tz)}. ${wet ? `${wet} hours with a rain chance of 20% or more.` : 'No meaningful rain chance.'}`;

  return (
    <div ref={box}>
      {w > 0 && (
        <svg viewBox={`0 0 ${w} ${h}`} height={h} role="img" aria-label={aria}>
          <defs>
            <linearGradient id="fw-tg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--fw-accent)" stopOpacity=".28" />
              <stop offset="1" stopColor="var(--fw-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2].map((g) => {
            const gy = top + (g * (cb - top)) / 2;
            return <line key={g} x1={pl} x2={w - pr} y1={gy} y2={gy} stroke="var(--fw-line)" strokeDasharray="2 4" />;
          })}
          {markers.map((m) => {
            const mx2 = pl + (m.at * (w - pl - pr)) / (n - 1);
            const flip = mx2 > w - 90;
            return (
              <g key={m.label}>
                <line x1={mx2} x2={mx2} y1={top - 14} y2={cb} stroke="var(--fw-muted)" strokeDasharray="3 3" opacity=".7" />
                <text x={flip ? mx2 - 4 : mx2 + 4} y={top - 8} fontSize="10.5" fill="var(--fw-muted)" fontFamily="var(--f-mono)" textAnchor={flip ? 'end' : 'start'}>
                  {m.label}
                </text>
              </g>
            );
          })}
          <path d={`${d} L${x(n - 1)} ${cb} L${x(0)} ${cb}Z`} fill="url(#fw-tg)" />
          <path d={d} fill="none" stroke="var(--fw-accent)" strokeWidth="2.5" strokeLinejoin="round" />
          {T.map((v, i) => i % step === 0 && (
            <g key={i}>
              <circle cx={x(i)} cy={y(v)} r="3.5" fill="var(--fw-surface)" stroke="var(--fw-accent)" strokeWidth="2" />
              <text x={x(i)} y={y(v) - 9} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--fw-ink)">{v}°</text>
            </g>
          ))}
          {hours.map((hr, i) => {
            const bw = Math.max(3, (w - pl - pr) / n - 3), bh = Math.max(1.5, (hr.pop / 100) * 16);
            return <rect key={i} x={x(i) - bw / 2} y={pb - bh} width={bw} height={bh} rx="1.5" fill={hr.pop ? 'var(--fw-cool)' : 'var(--fw-line)'} />;
          })}
          {hours.map((hr, i) => i % step === 0 && (
            <text key={i} x={x(i)} y={h - 22} textAnchor="middle" fontSize="11" fill="var(--fw-muted)" fontFamily="var(--f-mono)">
              {i === 0 ? 'now' : fmtHourShort(hr.time, tz)}
            </text>
          ))}
          <text x={pl} y={h - 4} fontSize="10.5" fill="var(--fw-cool)" fontFamily="var(--f-mono)">bars: rain chance (0 to 100%)</text>
        </svg>
      )}
    </div>
  );
}

export default function HourlyPage({ data }: { data: ForecastResponse }) {
  const { hourly, meta, now } = data;
  const tz = meta.tz;
  const nwsHours = hourly.filter((h) => h.source === 'NWS').length;

  return (
    <div className="hourly">
      <p className="summary">{data.summary}</p>
      <div className="chart-card">
        <div className="label" style={{ padding: '0 6px 6px' }}>
          Next 24 hours · temp and rain chance · {nwsHours >= hourly.length / 2 ? 'NWS blend' : 'Model'}
        </div>
        <HourlyChart hours={hourly} tz={tz} sunrise={now.sunrise} sunset={now.sunset} />
      </div>
      <div className="hlist">
        {hourly.map((h, i) => {
          const day = localDate(h.time, tz);
          const sep = i > 0 && day !== localDate(hourly[i - 1].time, tz);
          return (
            <Fragment key={h.time}>
              {sep && <div className="hrow sep">{fmtLongDate(h.time, tz)}</div>}
              <div className={`hrow${i === 0 ? ' now-row' : ''}`}>
                <span className="h">{i === 0 ? 'Now' : fmtHour(h.time, tz)}</span>
                <WxIcon code={h.icon} night={!h.isDay} />
                <span className="c">{h.condition}</span>
                <span className="t num">{h.temp}°</span>
                <span className={`p num${h.pop ? '' : ' zero'}`}>{h.pop}%</span>
                <span className="w num">
                  {[h.windDir, h.windSpeed].filter((v) => v != null).join(' ')}
                  {h.windGust && h.windSpeed != null && h.windGust > h.windSpeed + 4 ? ` g${h.windGust}` : ''}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
