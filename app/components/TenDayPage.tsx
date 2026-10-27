'use client';

import { useRef } from 'react';

import type { DayData, ForecastResponse, HalfDay } from '@/lib/types';

import { fmtDateKey, localDate } from '../lib/format';
import { ChevronLeft, ChevronRight, WxIcon } from './Icons';

function Half({ p, night }: { p: HalfDay; night: boolean }) {
  return (
    <div className="half">
      <div className="half-top">
        <WxIcon code={p.icon} night={night} />
        <div>
          <div className="hl">{p.name} · {night ? 'low' : 'high'}</div>
          <div className="temp disp num">{p.temp}°</div>
        </div>
      </div>
      <div className="cd">{p.condition}</div>
      <div className="facts">
        <span className="pp">Rain <b className="num">{p.pop}%</b></span>
        {p.wind && <span>Wind <b>{p.wind}</b></span>}
      </div>
      <div className="narr">{p.narrative}</div>
    </div>
  );
}

function DayCard({ d, today, lo, hi }: { d: DayData; today: string; lo: number; hi: number }) {
  const low = d.night?.temp ?? d.day?.temp ?? lo;
  const high = d.day?.temp ?? d.night?.temp ?? hi;
  const span = hi - lo || 1;
  const l = ((Math.min(low, high) - lo) / span) * 100;
  const r = ((Math.max(low, high) - lo) / span) * 100;
  const isToday = d.date === today;
  return (
    <article className="day" aria-label={`${isToday ? 'Today' : fmtDateKey(d.date, { weekday: 'long' })}, ${fmtDateKey(d.date)}`}>
      <div className="day-h">
        <span className="dname disp">{isToday ? 'Today' : fmtDateKey(d.date, { weekday: 'short' })}</span>
        <span className="ddate">{fmtDateKey(d.date, isToday ? { weekday: 'short', month: 'short', day: 'numeric' } : undefined)}</span>
        <span className="chip src" title={d.source === 'NWS' ? 'National Weather Service forecast' : 'Model guidance (ECMWF, GFS, ICON mean), past the NWS range'}>
          {d.source}
        </span>
      </div>
      {d.tags.length > 0 && <div className="tags">{d.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
      <div className="range num">
        <span>{d.night ? `${low}°` : ''}</span>
        <div className="track"><i style={{ left: `${l}%`, right: `${100 - r}%` }} /></div>
        <span>{d.day ? `${high}°` : ''}</span>
      </div>
      {d.spread && (
        <div className="spread">
          Models: high {d.spread.high[0]} to {d.spread.high[1]}° · low {d.spread.low[0]} to {d.spread.low[1]}°
        </div>
      )}
      {d.day && <Half p={d.day} night={false} />}
      {d.night && <Half p={d.night} night />}
    </article>
  );
}

export default function TenDayPage({ data, now }: { data: ForecastResponse; now: number }) {
  const row = useRef<HTMLDivElement>(null);
  const { days, meta } = data;
  const temps = days.flatMap((d) => [d.day?.temp, d.night?.temp]).filter((t): t is number => t != null);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const today = localDate(now, meta.tz);

  const by = (dir: 1 | -1) => {
    const el = row.current;
    const card = el?.querySelector<HTMLElement>('.day');
    if (el && card) el.scrollBy({ left: dir * (card.offsetWidth + 12) });
  };

  return (
    <div className="ten-wrap">
      <div className="ten" ref={row}>
        {days.map((d) => <DayCard key={d.date} d={d} today={today} lo={lo} hi={hi} />)}
      </div>
      <button className="arrow prev glass" aria-label="Earlier days" onClick={() => by(-1)}><ChevronLeft /></button>
      <button className="arrow next glass" aria-label="Later days" onClick={() => by(1)}><ChevronRight /></button>
    </div>
  );
}
