/**
 * Builds the normalized Fairweather forecast from NWS + Open-Meteo.
 *
 * Short-term stack (see README.md):
 *   Now        nearest fresh ASOS observation(s), else Open-Meteo current
 *   Hourly     weighted blend NWS 0.55 / NBM 0.25 / HRRR 0.15 / ECMWF 0.05, then observation nudge
 *   Days 1–7   NWS forecast periods, verbatim
 *   Days 8–10  mean of ECMWF, GFS, ICON (whichever report), with spread
 */
import { dateTags } from './calendar';
import {
  addDays, cToF, condFromNwsIcon, condFromWmo, degToCompass, distanceKm,
  hPaToInHg, kmhToMph, localParts, mToMi, paToInHg,
} from './conditions';
import {
  BLEND_MODELS, RANGE_MODELS, airQuality, expandGrid, nwsAlertsPoint, nwsForecast, nwsGrid, nwsHourly,
  nwsLatestObs, nwsPoint, nwsStations, omBest, omModels,
  type NwsAlertProps, type NwsObservation, type NwsPeriod, type NwsPoint, type OmBest, type OmModels,
} from './sources';
import type {
  AlertLevel, DayData, ForecastResponse, HalfDay, HourData, NowData, WxAlert,
} from './types';

const HOUR = 3600_000;
const GRID_STALE_MS = 6 * HOUR;

const settle = <T>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }));
const valOf = <T>(r: { ok: true; v: T } | { ok: false; e: unknown }): T | null => (r.ok ? r.v : null);
const r0 = (n: number) => Math.round(n);
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Local date of an Open-Meteo daily row. Its unixtime uses the *current* UTC offset for every row,
 * so after a DST change "midnight" lands at 23:00 the previous day; read the date at local noon instead.
 */
const dailyDate = (t: number, tz: string) => localParts(t * 1000 + 12 * HOUR, tz).date;

function weightedMean(pairs: [number | null | undefined, number][]): number | null {
  let s = 0, w = 0;
  for (const [v, wt] of pairs) {
    if (v == null || !Number.isFinite(v) || wt <= 0) continue;
    s += v * wt; w += wt;
  }
  return w > 0 ? s / w : null;
}

function mean(vals: (number | null | undefined)[]): number | null {
  const ok = vals.filter((v): v is number => v != null && Number.isFinite(v));
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

export function alertLevel(event: string): AlertLevel {
  if (/warning/i.test(event)) return 'warning';
  if (/watch/i.test(event)) return 'watch';
  if (/advisory/i.test(event)) return 'advisory';
  return 'statement';
}

export function toWxAlert(p: NwsAlertProps): WxAlert {
  const awips = p.parameters?.AWIPSidentifier?.[0];
  return {
    id: p.id, event: p.event, headline: p.headline, description: p.description, instruction: p.instruction,
    severity: p.severity, level: alertLevel(p.event), messageType: p.messageType, sent: p.sent,
    expires: p.expires, ends: p.ends, senderName: p.senderName,
    office: awips && awips.length >= 6 ? awips.slice(3) : null,
    zones: p.geocode?.UGC ?? [],
  };
}

function fmtHour(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' }).format(ms);
}

/* ------------------------------------------------------------------ */
/*  Now                                                                */
/* ------------------------------------------------------------------ */

interface ObsPick { station: string; obs: NwsObservation; km: number; lat: number; lon: number }

/**
 * Most stations report only hourly (around :53), and the NWS API shows each report a few minutes late.
 * Use the station reading whenever it's under 3 hours old (the UI shows its time); the cap only catches
 * stations that have stopped reporting. The forecast nudge is stricter, since an old reading would skew it.
 */
const OBS_MAX_AGE = 3 * HOUR;
const NUDGE_MAX_AGE = 80 * 60_000;

function pickObservation(list: ObsPick[], now: number): { primary: ObsPick; blend: ObsPick[] } | null {
  const usable = list.filter((o) => o.obs.temperature?.value != null && now - Date.parse(o.obs.timestamp) < OBS_MAX_AGE);
  if (!usable.length) return null;
  // Closest and newest wins: 1 km of distance counts the same as 2 minutes of report age
  const score = (o: ObsPick) => o.km + (now - Date.parse(o.obs.timestamp)) / 60_000 / 2;
  usable.sort((a, b) => score(a) - score(b));
  const primary = usable[0];
  const t0 = Date.parse(primary.obs.timestamp);
  // Distance-weighted mean with nearby stations (within 25 km) reporting at about the same time
  const blend = usable.filter((o) =>
    distanceKm(primary.lat, primary.lon, o.lat, o.lon) <= 25 && Math.abs(Date.parse(o.obs.timestamp) - t0) <= 30 * 60_000);
  return { primary, blend };
}

function obsMean(picks: ObsPick[], get: (o: NwsObservation) => number | null | undefined): number | null {
  return weightedMean(picks.map((p) => [get(p.obs), 1 / Math.max(1, p.km)]));
}

function buildNow(
  om: OmBest, picked: { primary: ObsPick; blend: ObsPick[] } | null, tz: string, now: number,
  aq: { aqi: number | null; pollutant: string | null } | null, gridSky: number | null,
): NowData {
  const c = om.current;
  const P = picked?.blend ?? [];
  const has = P.length > 0;
  const fromC = (g: (o: NwsObservation) => number | null | undefined, conv: (n: number) => number) => {
    const v = has ? obsMean(P, g) : null;
    return v == null ? null : conv(v);
  };

  const temp = fromC((o) => o.temperature?.value, cToF) ?? c.temperature_2m ?? null;
  const dew = fromC((o) => o.dewpoint?.value, cToF) ?? c.dew_point_2m ?? null;
  const wc = fromC((o) => o.windChill?.value, cToF);
  const hi = fromC((o) => o.heatIndex?.value, cToF);
  const press = fromC((o) => o.seaLevelPressure?.value ?? o.barometricPressure?.value, paToInHg);
  const vis = fromC((o) => o.visibility?.value, mToMi);
  const visUnit = om.hourly_units?.visibility;
  const omVis = c.visibility != null ? (visUnit === 'ft' ? c.visibility / 5280 : c.visibility / 1609.344) : null;
  const primary = picked?.primary.obs;

  const hIdx = new Map(om.hourly.time.map((t, i) => [t * 1000, i]));
  const hour0 = Math.floor(now / HOUR) * HOUR;
  const i0 = hIdx.get(hour0) ?? om.hourly.time.findIndex((t) => t * 1000 >= hour0);

  const pressure24: number[] = [];
  const rainHourly: number[] = [];
  for (let k = 23; k >= 0; k--) {
    const i = i0 - k;
    if (i < 0) continue;
    const p = om.hourly.pressure_msl?.[i];
    if (p != null) pressure24.push(r2(hPaToInHg(p)));
    rainHourly.push(om.hourly.precipitation?.[i] ?? 0);
  }
  let trend: NowData['pressureTrend'] = null;
  if (pressure24.length >= 4) {
    const d = pressure24[pressure24.length - 1] - pressure24[pressure24.length - 4];
    trend = d > 0.02 ? 'up' : d < -0.02 ? 'down' : 'steady';
  }

  // UV peak for today
  const today = localParts(now, tz).date;
  let uvPeak: number | null = null, uvPeakTime: string | null = null;
  om.hourly.time.forEach((t, i) => {
    if (localParts(t * 1000, tz).date !== today) return;
    const u = om.hourly.uv_index?.[i];
    if (u != null && (uvPeak == null || u > uvPeak)) { uvPeak = u; uvPeakTime = new Date(t * 1000).toISOString(); }
  });

  const dIdx = om.daily.time.findIndex((t) => dailyDate(t, tz) === today);
  const sr = dIdx >= 0 ? om.daily.sunrise?.[dIdx] : null;
  const ss = dIdx >= 0 ? om.daily.sunset?.[dIdx] : null;

  const wmo = condFromWmo(c.weather_code);
  const nwsIcon = condFromNwsIcon(primary?.icon);
  const windDeg = has ? primary?.windDirection?.value ?? null : null;

  return {
    observedAt: primary ? primary.timestamp : new Date(c.time * 1000).toISOString(),
    source: has ? 'ASOS' : 'Model',
    station: has ? P.map((p) => p.station).join(' + ') : null,
    temp: temp == null ? null : r0(temp),
    feelsLike: r0(wc ?? hi ?? (has ? temp : c.apparent_temperature) ?? temp ?? 0),
    dewPoint: dew == null ? null : r0(dew),
    humidity: (() => { const h = has ? obsMean(P, (o) => o.relativeHumidity?.value) : null; return r0(h ?? c.relative_humidity_2m); })(),
    windSpeed: r0(fromC((o) => o.windSpeed?.value, kmhToMph) ?? c.wind_speed_10m ?? 0),
    windGust: (() => { const g = fromC((o) => o.windGust?.value, kmhToMph) ?? c.wind_gusts_10m; return g == null ? null : r0(g); })(),
    windDeg: windDeg ?? c.wind_direction_10m ?? null,
    pressure: press != null ? r2(press) : c.pressure_msl != null ? r2(hPaToInHg(c.pressure_msl)) : null,
    pressureTrend: trend,
    pressure24,
    visibility: (() => { const v = vis ?? omVis; return v == null ? null : Math.min(10, Math.round(v * 10) / 10); })(),
    cloudCover: gridSky ?? c.cloud_cover ?? null,
    condition: (has && primary?.textDescription) || wmo.text,
    icon: nwsIcon?.cond ?? wmo.cond,
    isDay: c.is_day === 1,
    uv: c.uv_index != null ? Math.round(c.uv_index) : null,
    uvPeak: uvPeak == null ? null : Math.round(uvPeak),
    uvPeakTime,
    aqi: aq?.aqi ?? null,
    aqiPollutant: aq?.pollutant ?? null,
    rain24: r2(rainHourly.reduce((a, b) => a + b, 0)),
    rain24Hourly: rainHourly.map(r2),
    rain24Start: new Date(hour0 - 23 * HOUR).toISOString(),
    high: null,
    low: null,
    sunrise: sr ? new Date(sr * 1000).toISOString() : null,
    sunset: ss ? new Date(ss * 1000).toISOString() : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Hourly                                                             */
/* ------------------------------------------------------------------ */

function parseMph(s: string | undefined): number | null {
  const nums = s?.match(/\d+/g)?.map(Number);
  return nums?.length ? Math.max(...nums) : null;
}

function buildHourly(
  om: OmBest, models: OmModels | null, hourlyNws: NwsPeriod[] | null, gridGust: Map<number, number>,
  gridStale: boolean, now: NowData, nowMs: number,
): HourData[] {
  const hour0 = Math.floor(nowMs / HOUR) * HOUR;
  const nwsByHour = new Map((hourlyNws ?? []).map((p) => [Date.parse(p.startTime), p]));
  const omIdx = new Map(om.hourly.time.map((t, i) => [t * 1000, i]));
  const mIdx = new Map((models?.hourly.time ?? []).map((t, i) => [t * 1000, i]));
  const m = (field: string, model: string, t: number) => {
    const i = mIdx.get(t);
    return i == null ? null : models?.hourly[`${field}_${model}`]?.[i] ?? null;
  };

  const out: HourData[] = [];
  for (let h = 0; h < 24; h++) {
    const t = hour0 + h * HOUR;
    const n = nwsByHour.get(t);
    const oi = omIdx.get(t);
    const lead = h + 1;
    const wNws = gridStale && lead <= 12 ? 0 : 0.55;
    const wHrrr = lead > 18 ? 0 : 0.15;
    const wNbm = 0.25 + (lead > 18 ? 0.15 : 0);
    const blend = (nws: number | null, field: string) => weightedMean([
      [nws, n ? wNws : 0],
      [m(field, BLEND_MODELS[0], t), wNbm],
      [m(field, BLEND_MODELS[1], t), wHrrr],
      [m(field, BLEND_MODELS[2], t), 0.05],
    ]);
    const omv = (k: string) => (oi == null ? null : om.hourly[k]?.[oi] ?? null);

    const nTemp = n ? n.temperature : null;
    const nDew = n?.dewpoint?.value != null ? cToF(n.dewpoint.value) : null;
    const gustK = gridGust.get(t);
    const temp = blend(nTemp, 'temperature_2m') ?? omv('temperature_2m');
    if (temp == null) continue;

    const wmo = condFromWmo(omv('weather_code'));
    const nIcon = condFromNwsIcon(n?.icon);
    const windDir = n?.windDirection || degToCompass(omv('wind_direction_10m'));
    out.push({
      time: new Date(t).toISOString(),
      temp,
      dewPoint: blend(nDew, 'dew_point_2m') ?? omv('dew_point_2m'),
      pop: n?.probabilityOfPrecipitation?.value ?? omv('precipitation_probability') ?? 0,
      windSpeed: (() => { const v = blend(parseMph(n?.windSpeed), 'wind_speed_10m') ?? omv('wind_speed_10m'); return v == null ? null : r0(v); })(),
      windGust: (() => { const v = blend(gustK != null ? kmhToMph(gustK) : null, 'wind_gusts_10m') ?? omv('wind_gusts_10m'); return v == null ? null : r0(v); })(),
      windDir: windDir || null,
      condition: n?.shortForecast ?? wmo.text,
      icon: nIcon?.cond ?? wmo.cond,
      isDay: n ? n.isDaytime : omv('is_day') === 1,
      source: n ? 'NWS' : 'Model',
    });
  }

  // Observation nudge: remove the "forecast says 50, it's 44" error, decaying to zero by hour 6
  if (now.source === 'ASOS' && nowMs - Date.parse(now.observedAt) < NUDGE_MAX_AGE && out.length) {
    const errT = now.temp != null ? now.temp - out[0].temp : 0;
    const errD = now.dewPoint != null && out[0].dewPoint != null ? now.dewPoint - out[0].dewPoint : 0;
    for (let h = 0; h < Math.min(6, out.length); h++) {
      const f = 1 - h / 6;
      out[h].temp += errT * f;
      if (out[h].dewPoint != null) out[h].dewPoint! += errD * f;
    }
  }
  for (const o of out) {
    o.temp = r0(o.temp);
    if (o.dewPoint != null) o.dewPoint = r0(o.dewPoint);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Days                                                               */
/* ------------------------------------------------------------------ */

function nwsHalf(p: NwsPeriod): HalfDay {
  const ic = condFromNwsIcon(p.icon);
  const speed = p.windSpeed.replace(/\s+to\s+/, '-');
  return {
    name: p.name,
    temp: p.temperature,
    condition: p.shortForecast,
    icon: ic?.cond ?? 'cloudy',
    pop: p.probabilityOfPrecipitation?.value ?? 0,
    wind: `${p.windDirection} ${speed}`.trim(),
    narrative: p.detailedForecast,
  };
}

function nwsDays(periods: NwsPeriod[], tz: string, today: string): DayData[] {
  const byDate = new Map<string, DayData>();
  for (const p of periods) {
    const lp = localParts(p.startTime, tz);
    // A night period starting after midnight ("Overnight") belongs to the previous evening
    const date = !p.isDaytime && lp.hour < 12 ? addDays(lp.date, -1) : lp.date;
    if (date < today) continue;
    let d = byDate.get(date);
    if (!d) {
      d = { date, source: 'NWS', day: null, night: null, tags: dateTags(date, tz) };
      byDate.set(date, d);
    }
    if (p.isDaytime) d.day ??= nwsHalf(p);
    else d.night ??= nwsHalf(p);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 7);
}

function modelDays(models: OmModels | null, om: OmBest, tz: string, fromDate: string, count: number): DayData[] {
  const out: DayData[] = [];
  const src = models?.daily ?? om.daily;
  const pick = (field: string, i: number, list: readonly string[]) =>
    models ? list.map((mm) => src[`${field}_${mm}`]?.[i] ?? null) : [src[field]?.[i] ?? null];

  src.time.forEach((t, i) => {
    if (out.length >= count) return;
    const date = dailyDate(t, tz);
    if (date < fromDate) return;
    const highs = pick('temperature_2m_max', i, RANGE_MODELS).filter((v): v is number => v != null);
    const lows = pick('temperature_2m_min', i, RANGE_MODELS).filter((v): v is number => v != null);
    if (!highs.length || !lows.length) return;
    const hi = r0(mean(highs)!);
    const lo = r0(mean(lows)!);
    const pop = r0(mean(pick('precipitation_probability_max', i, RANGE_MODELS)) ?? 0);
    const code = pick('weather_code', i, RANGE_MODELS).find((v) => v != null) ?? null;
    const ws = mean(pick('wind_speed_10m_max', i, RANGE_MODELS));
    const wd = mean(pick('wind_direction_10m_dominant', i, RANGE_MODELS));
    const w = condFromWmo(code);
    const wind = ws != null ? `${degToCompass(wd) ?? ''} ${r0(ws)} mph`.trim() : '';
    const text = w.text.toLowerCase();
    out.push({
      date, source: 'Model', tags: dateTags(date, tz),
      day: { name: 'Day', temp: hi, condition: w.text, icon: w.cond, pop, wind, narrative: `Model guidance: ${text}, high near ${hi}.` },
      night: { name: 'Night', temp: lo, condition: w.text, icon: w.cond, pop, wind, narrative: `Model guidance: ${text}, low near ${lo}.` },
      spread: highs.length > 1 ? {
        high: [r0(Math.min(...highs)), r0(Math.max(...highs))],
        low: [r0(Math.min(...lows)), r0(Math.max(...lows))],
      } : undefined,
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/*  Summary sentence                                                   */
/* ------------------------------------------------------------------ */

function summarize(hours: HourData[], tz: string): string {
  if (!hours.length) return '';
  const parts: string[] = [];
  const wet = hours.find((h) => h.pop >= 50);
  const maybe = hours.find((h) => h.pop >= 20);
  const at = (h: HourData) => fmtHour(Date.parse(h.time), tz);
  if (wet) {
    const peak = hours.reduce((a, b) => (b.pop > a.pop ? b : a));
    parts.push(`${wet === hours[0] ? 'Rain likely now' : `Rain likely from around ${at(wet)}`}, peaking at ${peak.pop}% around ${at(peak)}.`);
  } else if (maybe) {
    parts.push(`A slight chance of rain around ${at(maybe)}, otherwise mostly dry.`);
  } else {
    parts.push('Dry for the next 24 hours.');
  }
  const first12 = hours.slice(0, 12);
  const max = first12.reduce((a, b) => (b.temp > a.temp ? b : a));
  const min = hours.reduce((a, b) => (b.temp < a.temp ? b : a));
  if (max !== hours[0] && max.temp > hours[0].temp + 1) parts.push(`Topping out at ${max.temp}° around ${at(max)}.`);
  else parts.push(`Falling to ${min.temp}° by ${at(min)}.`);
  const gust = hours.reduce((a, b) => ((b.windGust ?? 0) > (a.windGust ?? 0) ? b : a));
  if ((gust.windGust ?? 0) >= 30) parts.push(`Gusts to ${gust.windGust} mph around ${at(gust)}.`);
  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

export async function buildForecast(lat: number, lon: number): Promise<ForecastResponse> {
  const nowMs = Date.now();
  const [ptR, omR, mR, aqR, alR] = await Promise.all([
    settle(nwsPoint(lat, lon)),
    settle(omBest(lat, lon)),
    settle(omModels(lat, lon)),
    settle(airQuality(lat, lon)),
    settle(nwsAlertsPoint(lat, lon)),
  ]);
  if (!omR.ok && !ptR.ok) throw new Error("Couldn't reach NWS or Open-Meteo");
  if (!omR.ok) throw new Error("Couldn't reach Open-Meteo");
  const om = omR.v;
  const pt: NwsPoint | null = valOf(ptR);
  const models = valOf(mR);
  // Open-Meteo's zone comes from the coordinates; NWS reports America/New_York for Puerto Rico
  const tz = om.timezone || pt?.tz || 'America/Chicago';
  const errors: string[] = [];

  const [fcR, hrR, gridR, obsR] = pt
    ? await Promise.all([
        settle(nwsForecast(pt)),
        settle(nwsHourly(pt)),
        settle(nwsGrid(pt)),
        settle((async () => {
          const st = await nwsStations(pt, lat, lon);
          const res = await Promise.all(st.map((s) => settle(nwsLatestObs(s.id))));
          const picks: ObsPick[] = [];
          res.forEach((r, i) => { if (r.ok) picks.push({ station: st[i].id, obs: r.v, km: st[i].km, lat: st[i].lat, lon: st[i].lon }); });
          return picks;
        })()),
      ])
    : [null, null, null, null];

  const fc = fcR ? valOf(fcR) : null;
  const hr = hrR ? valOf(hrR) : null;
  const grid = gridR ? valOf(gridR) : null;
  const obs = obsR ? valOf(obsR) ?? [] : [];

  const gridUpdated = grid?.updateTime ?? null;
  const gridStale = gridUpdated ? nowMs - Date.parse(gridUpdated) > GRID_STALE_MS : false;
  const gust = new Map<number, number>();
  if (grid?.windGust) {
    const isMph = grid.windGust.uom?.includes('mi_h');
    for (const [t, v] of expandGrid(grid.windGust)) gust.set(t, isMph ? v / 0.621371 : v);
  }

  const sky = expandGrid(grid?.skyCover).get(Math.floor(nowMs / HOUR) * HOUR) ?? null;
  const now = buildNow(om, pickObservation(obs, nowMs), tz, nowMs, valOf(aqR), sky);
  const hourly = buildHourly(om, models, hr?.periods ?? null, gust, gridStale, now, nowMs);
  // ASOS ceilometers only see clouds below 12,000 ft, so a high overcast reports as "Clear".
  // When the NWS grid disagrees, describe the sky with the NWS forecast for this hour instead.
  if (now.source === 'ASOS' && sky != null && sky >= 60 && hourly[0]?.source === 'NWS' && /^(clear|fair|sunny|mostly clear)/i.test(now.condition)) {
    now.condition = hourly[0].condition;
    now.icon = hourly[0].icon;
  }
  const today = localParts(nowMs, tz).date;

  let days: DayData[];
  if (fc?.periods?.length) {
    days = nwsDays(fc.periods, tz, today);
    const next = days.length ? addDays(days[days.length - 1].date, 1) : today;
    days = days.concat(modelDays(models, om, tz, next, 10 - days.length));
  } else {
    days = modelDays(models, om, tz, today, 10);
    errors.push("Couldn't reach NWS. Showing model data for all 10 days.");
  }
  if (fc && !hr) errors.push("Couldn't reach the NWS hourly forecast. Showing model data for the next 24 hours.");
  if (pt && !alR.ok) errors.push("Couldn't check NWS alerts. Trying again in 2 minutes.");

  const d0 = days[0];
  now.high = d0?.day?.temp ?? (hourly.length ? Math.max(...hourly.slice(0, 18).map((h) => h.temp)) : null);
  now.low = d0?.night?.temp ?? (hourly.length ? Math.min(...hourly.map((h) => h.temp)) : null);

  const alerts = (valOf(alR) ?? [])
    .map(toWxAlert)
    .filter((a) => a.messageType !== 'Cancel')
    .sort((a, b) => ['warning', 'watch', 'advisory', 'statement'].indexOf(a.level) - ['warning', 'watch', 'advisory', 'statement'].indexOf(b.level));

  return {
    now,
    hourly,
    days,
    alerts,
    summary: summarize(hourly, tz),
    meta: {
      lat, lon, tz,
      office: pt?.office ?? null,
      officeName: pt?.officeName ?? null,
      place: pt?.place ?? null,
      updated: new Date(nowMs).toISOString(),
      gridUpdated, gridStale,
      radarSite: pt?.radarSite ?? null,
      zones: pt?.zones ?? [],
      errors,
      nwsOk: !!fc,
    },
  };
}

