'use client';

import { useState } from 'react';

import type { DayData, ForecastResponse, HalfDay } from '@/lib/types';

import { fmtDateKey, localDate } from '../lib/format';
import { ChevronDown, WxIcon } from './Icons';

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

const Drop = () => (
  <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><path d="M5 0C7 3 9 5.4 9 7.6a4 4 0 0 1-8 0C1 5.4 3 3 5 0z" fill="currentColor" /></svg>
);

/** Summary row (icon, rain chance, low–high bar); tapping it opens the day and night details */
function DayRow({ d, today, lo, hi, open, onToggle }: { d: DayData; today: string; lo: number; hi: number; open: boolean; onToggle: () => void }) {
  const low = d.night?.temp ?? d.day?.temp ?? lo;
  const high = d.day?.temp ?? d.night?.temp ?? hi;
  const span = hi - lo || 1;
  const l = ((Math.min(low, high) - lo) / span) * 100;
  const r = ((Math.max(low, high) - lo) / span) * 100;
  const isToday = d.date === today;
  const lead = d.day ?? d.night;
  const pop = lead?.pop ?? 0;
  const name = isToday ? 'Today' : fmtDateKey(d.date, { weekday: 'short' });
  const id = `day-${d.date}`;
  return (
    <article className={`dayrow${open ? ' open' : ''}`}>
      <button
        className="dsum"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${isToday ? 'Today' : fmtDateKey(d.date, { weekday: 'long' })}, ${lead?.condition ?? ''}, ${d.day ? `high ${high}°, ` : ''}${d.night ? `low ${low}°, ` : ''}rain ${pop}%`}
        onClick={onToggle}
      >
        <span className="dwhen">
          <span className="dname disp">{name}</span>
          <span className="ddate">{fmtDateKey(d.date, { month: 'short', day: 'numeric' })}</span>
        </span>
        {lead && <WxIcon code={lead.icon} night={!d.day} />}
        <span className="dcond">{lead?.condition}</span>
        <span className={`dpop num${pop ? '' : ' zero'}`}><Drop />{pop}%</span>
        <span className="dlo num">{d.night ? `${low}°` : ''}</span>
        <span className="track"><i style={{ left: `${l}%`, right: `${100 - r}%` }} /></span>
        <span className="dhi num">{d.day ? `${high}°` : ''}</span>
        <ChevronDown rotate={open ? 180 : 0} />
      </button>
      <div className="ddetail" id={id} role="region" aria-label={`${name} details`} inert={!open}>
        <div className="ddetail-in">
          <div className="dmeta">
            {d.tags.map((t) => <span key={t} className="tag">{t}</span>)}
            <span className="chip src" title={d.source === 'NWS' ? 'National Weather Service forecast' : 'Model guidance (ECMWF, GFS, ICON mean), past the NWS range'}>
              {d.source}
            </span>
          </div>
          {d.spread && (
            <div className="spread">
              Models: high {d.spread.high[0]} to {d.spread.high[1]}° · low {d.spread.low[0]} to {d.spread.low[1]}°
            </div>
          )}
          <div className="halves">
            {d.day && <Half p={d.day} night={false} />}
            {d.night && <Half p={d.night} night />}
          </div>
        </div>
      </div>
    </article>
  );
}

export default function TenDayPage({ data, now }: { data: ForecastResponse; now: number }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const { days, meta } = data;
  const temps = days.flatMap((d) => [d.day?.temp, d.night?.temp]).filter((t): t is number => t != null);
  const lo = Math.min(...temps), hi = Math.max(...temps);
  const today = localDate(now, meta.tz);

  const toggle = (date: string) => setOpen((s) => {
    const next = new Set(s);
    if (!next.delete(date)) next.add(date);
    return next;
  });

  return (
    <div className="ten">
      {days.map((d) => (
        <DayRow key={d.date} d={d} today={today} lo={lo} hi={hi} open={open.has(d.date)} onToggle={() => toggle(d.date)} />
      ))}
    </div>
  );
}
