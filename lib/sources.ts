/**
 * Upstream fetchers for Fairweather: NWS, Open-Meteo, AirNow, and IEM.
 * Server-side only — NWS requires a User-Agent with contact info.
 */
import { distanceKm } from './conditions';
import type { RadarSite } from './types';

const NWS = process.env.FAIRWEATHER_NWS_BASE || 'https://api.weather.gov';
const UA = process.env.FAIRWEATHER_USER_AGENT || 'Fairweather/1.0 (john@jroverton.com)';

/* ------------------------------------------------------------------ */
/*  Tiny TTL cache with in-flight dedupe                               */
/* ------------------------------------------------------------------ */

const cache = new Map<string, { exp: number; p: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.p as Promise<T>;
  const p = fn();
  cache.set(key, { exp: now + ttlMs, p });
  p.catch(() => {
    if (cache.get(key)?.p === p) cache.delete(key);
  });
  if (cache.size > 2000) {
    for (const [k, v] of cache) if (v.exp <= now) cache.delete(k);
  }
  return p;
}

async function getJson<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(init?.timeoutMs ?? 9000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${new URL(url).host}`);
  return res.json() as Promise<T>;
}

const nwsGet = <T>(path: string) =>
  getJson<T>(path.startsWith('http') ? path : `${NWS}${path}`, {
    headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
  });

/* ------------------------------------------------------------------ */
/*  NWS                                                                */
/* ------------------------------------------------------------------ */

interface QV { value: number | null; unitCode?: string }

export interface NwsPoint {
  office: string;
  officeName: string | null;
  gridX: number;
  gridY: number;
  forecastUrl: string;
  hourlyUrl: string;
  gridUrl: string;
  stationsUrl: string;
  tz: string;
  place: string | null;
  zones: string[];
  radarSite: RadarSite | null;
}

interface PointsJson {
  properties: {
    gridId: string; gridX: number; gridY: number;
    forecast: string; forecastHourly: string; forecastGridData: string; observationStations: string;
    forecastZone: string; county: string; fireWeatherZone?: string; timeZone: string; radarStation?: string;
    relativeLocation?: { properties: { city: string; state: string } };
  };
}

const lastSeg = (u: string | undefined) => (u ? u.split('/').pop() ?? '' : '');

/** `/points` lookup plus office name and radar site; cached 24 h. */
export function nwsPoint(lat: number, lon: number): Promise<NwsPoint> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  return cached(`points:${key}`, 24 * 3600_000, async () => {
    const p = (await nwsGet<PointsJson>(`/points/${key}`)).properties;
    const [officeName, radarSite] = await Promise.all([
      cached(`office:${p.gridId}`, 7 * 86400_000, async () => {
        const o = await nwsGet<{ name?: string }>(`/offices/${p.gridId}`);
        return o.name ? o.name.replace(/,\s*[A-Z]{2}$/, '') : null;
      }).catch(() => null),
      p.radarStation
        ? cached(`radar:${p.radarStation}`, 7 * 86400_000, async () => {
            const r = await nwsGet<{ geometry: { coordinates: [number, number] }; properties: { name: string } }>(
              `/radar/stations/${p.radarStation}`,
            );
            return { id: p.radarStation!, name: r.properties.name, lon: r.geometry.coordinates[0], lat: r.geometry.coordinates[1] };
          }).catch(() => null)
        : Promise.resolve(null),
    ]);
    const rel = p.relativeLocation?.properties;
    return {
      office: p.gridId, officeName, gridX: p.gridX, gridY: p.gridY,
      forecastUrl: p.forecast, hourlyUrl: p.forecastHourly, gridUrl: p.forecastGridData,
      stationsUrl: p.observationStations, tz: p.timeZone,
      place: rel ? `${rel.city}, ${rel.state}` : null,
      zones: [lastSeg(p.forecastZone), lastSeg(p.county)].filter(Boolean),
      radarSite,
    };
  });
}

export interface NwsPeriod {
  number: number; name: string; startTime: string; endTime: string; isDaytime: boolean;
  temperature: number; temperatureUnit: string;
  probabilityOfPrecipitation?: QV; dewpoint?: QV; relativeHumidity?: QV;
  windSpeed: string; windDirection: string; icon: string; shortForecast: string; detailedForecast: string;
}

export const nwsForecast = (pt: NwsPoint) =>
  cached(`fc:${pt.forecastUrl}`, 15 * 60_000, async () =>
    (await nwsGet<{ properties: { periods: NwsPeriod[]; updateTime?: string } }>(pt.forecastUrl)).properties);

export const nwsHourly = (pt: NwsPoint) =>
  cached(`fch:${pt.hourlyUrl}`, 15 * 60_000, async () =>
    (await nwsGet<{ properties: { periods: NwsPeriod[]; updateTime?: string } }>(pt.hourlyUrl)).properties);

interface GridLayer { uom?: string; values: { validTime: string; value: number | null }[] }
export interface NwsGrid { updateTime: string; windGust?: GridLayer; skyCover?: GridLayer }

export const nwsGrid = (pt: NwsPoint) =>
  cached(`grid:${pt.gridUrl}`, 15 * 60_000, async () => {
    const p = (await nwsGet<{ properties: NwsGrid }>(pt.gridUrl)).properties;
    return { updateTime: p.updateTime, windGust: p.windGust, skyCover: p.skyCover } as NwsGrid;
  });

/** Expand a grid layer (`2026-10-27T11:00:00+00:00/PT2H`) into a value per UTC hour (ms → value). */
export function expandGrid(layer: GridLayer | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (!layer) return out;
  for (const { validTime, value } of layer.values) {
    if (value == null) continue;
    const [start, dur] = validTime.split('/');
    const t0 = Date.parse(start);
    const m = dur?.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?)?/);
    const hours = m ? Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) : 1;
    for (let h = 0; h < Math.max(1, hours); h++) out.set(t0 + h * 3600_000, value);
  }
  return out;
}

interface StationsJson {
  features: { geometry: { coordinates: [number, number] }; properties: { stationIdentifier: string; name: string } }[];
}

/** Nearest observation stations within 40 km (up to 4), cached 24 h. */
export function nwsStations(pt: NwsPoint, lat: number, lon: number) {
  return cached(`stations:${pt.stationsUrl}`, 24 * 3600_000, async () => {
    const j = await nwsGet<StationsJson>(`${pt.stationsUrl}?limit=10`);
    return j.features
      .map((f) => ({
        id: f.properties.stationIdentifier,
        name: f.properties.name,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        km: distanceKm(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]),
      }))
      .sort((a, b) => a.km - b.km)
      .filter((s, i) => i === 0 || s.km <= 40)
      .slice(0, 4);
  });
}

export interface NwsObservation {
  timestamp: string; textDescription: string; icon: string | null; rawMessage?: string;
  temperature: QV; dewpoint: QV; windDirection: QV; windSpeed: QV; windGust: QV;
  barometricPressure: QV; seaLevelPressure: QV; visibility: QV; relativeHumidity: QV;
  windChill: QV; heatIndex: QV;
}

/**
 * The NWS API often leaves the parsed fields of an hourly METAR blank (seen at KMKC, and every recent
 * PHNL report) while `rawMessage` still has them. Fill blanks from the METAR text, in API units:
 * °C, km/h, degrees, Pa, m, %.
 */
export function fillFromMetar(o: NwsObservation): NwsObservation {
  const raw = o.rawMessage;
  if (!raw) return o;
  const out: NwsObservation = { ...o };
  const set = (k: keyof NwsObservation, v: number | null) => {
    const cur = out[k] as QV | undefined;
    if (v != null && Number.isFinite(v) && (cur?.value == null)) (out[k] as QV) = { value: v };
  };
  const signed = (sign: string, digits: string) => (sign === '1' ? -1 : 1) * Number(digits) / 10;
  const tGroup = raw.match(/\bT([01])(\d{3})(?:([01])(\d{3}))?\b/);
  const body = raw.match(/\s(M?\d{2})\/(M?\d{2})?\s/);
  const whole = (v?: string) => (v ? (v.startsWith('M') ? -1 : 1) * Number(v.replace('M', '')) : null);
  const t = tGroup ? signed(tGroup[1], tGroup[2]) : whole(body?.[1]);
  const td = tGroup?.[3] ? signed(tGroup[3], tGroup[4]) : whole(body?.[2]);
  set('temperature', t);
  set('dewpoint', td);
  if (t != null && td != null) {
    const rh = 100 * Math.exp((17.625 * td) / (243.04 + td)) / Math.exp((17.625 * t) / (243.04 + t));
    set('relativeHumidity', Math.min(100, rh));
  }
  const wind = raw.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)\b/);
  if (wind) {
    const k = wind[4] === 'KT' ? 1.852 : 3.6;
    if (wind[1] !== 'VRB') set('windDirection', Number(wind[1]));
    set('windSpeed', Number(wind[2]) * k);
    if (wind[3]) set('windGust', Number(wind[3]) * k);
  }
  const vis = raw.match(/\s(?:(\d+)\s)?M?(\d+)(?:\/(\d+))?SM\b/);
  if (vis) set('visibility', (Number(vis[1] ?? 0) + (vis[3] ? Number(vis[2]) / Number(vis[3]) : Number(vis[2]))) * 1609.344);
  const alt = raw.match(/\bA(\d{4})\b/);
  if (alt) set('barometricPressure', (Number(alt[1]) / 100) * 3386.389);
  const slp = raw.match(/\bSLP(\d{3})\b/);
  if (slp) { const n = Number(slp[1]) / 10; set('seaLevelPressure', (n < 50 ? 1000 + n : 900 + n) * 100); }
  return out;
}

/**
 * Newest report from a station that has a temperature, with blank fields filled from its METAR.
 * Not `/observations/latest`, which returned records with no usable temperature.
 */
export const nwsLatestObs = (station: string) =>
  cached(`obs:${station}`, 5 * 60_000, async () => {
    const j = await nwsGet<{ features: { properties: NwsObservation }[] }>(`/stations/${station}/observations?limit=4`);
    const withTemp = j.features.map((f) => fillFromMetar(f.properties)).filter((p) => p.temperature?.value != null);
    if (!withTemp.length) throw new Error(`no recent temperature from ${station}`);
    return withTemp.reduce((a, b) => (Date.parse(b.timestamp) > Date.parse(a.timestamp) ? b : a));
  });

interface AlertsJson {
  features: {
    properties: {
      id: string; event: string; headline: string | null; description: string; instruction: string | null;
      severity: string; messageType: string; sent: string; expires: string | null; ends: string | null;
      senderName: string; parameters?: { AWIPSidentifier?: string[] }; geocode?: { UGC?: string[] };
      affectedZones?: string[]; references?: { identifier: string }[];
    };
  }[];
}
export type NwsAlertProps = AlertsJson['features'][number]['properties'];

export const nwsAlertsPoint = (lat: number, lon: number) =>
  cached(`alerts:${lat.toFixed(3)},${lon.toFixed(3)}`, 2 * 60_000, async () =>
    (await nwsGet<AlertsJson>(`/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`)).features.map((f) => f.properties));

/** Active alerts for up to 25 zones at a time (cron fan-out). */
export const nwsAlertsZones = async (zones: string[]) =>
  (await nwsGet<AlertsJson>(`/alerts/active?zone=${zones.join(',')}`)).features.map((f) => f.properties);

/* ------------------------------------------------------------------ */
/*  Open-Meteo                                                         */
/* ------------------------------------------------------------------ */

const OM = 'https://api.open-meteo.com/v1/forecast';
const OM_UNITS = 'temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timeformat=unixtime&timezone=auto';

type Series = Record<string, (number | null)[]>;
export interface OmBest {
  timezone: string;
  current: Record<string, number> & { time: number };
  hourly: Series & { time: number[] };
  hourly_units: Record<string, string>;
  daily: Series & { time: number[] };
  minutely_15?: Series & { time: number[] };
}

const round2 = (n: number) => n.toFixed(2);

/** Best-match forecast: current, hourly (past 24 h + 10 days), daily, minutely_15. Cached 15 min. */
export function omBest(lat: number, lon: number): Promise<OmBest> {
  const url = `${OM}?latitude=${round2(lat)}&longitude=${round2(lon)}&${OM_UNITS}` +
    '&past_days=1&forecast_days=10' +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m,' +
    'wind_direction_10m,pressure_msl,cloud_cover,visibility,weather_code,is_day,uv_index' +
    '&hourly=temperature_2m,dew_point_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,' +
    'cloud_cover,pressure_msl,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,' +
    'wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset,uv_index_max' +
    '&minutely_15=precipitation&past_minutely_15=4&forecast_minutely_15=8';
  return cached(`om:${round2(lat)},${round2(lon)}`, 15 * 60_000, () => getJson<OmBest>(url));
}

export const BLEND_MODELS = ['ncep_nbm_conus', 'gfs_hrrr', 'ecmwf_ifs025'] as const;
export const RANGE_MODELS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless'] as const;

export interface OmModels {
  hourly: Series & { time: number[] };
  daily: Series & { time: number[] };
}

/** Per-model values for the hourly blend (48 h) and days 8–10 (mean of 3 models). Cached 15 min. */
export function omModels(lat: number, lon: number): Promise<OmModels> {
  const models = [...new Set([...BLEND_MODELS, ...RANGE_MODELS])].join(',');
  const url = `${OM}?latitude=${round2(lat)}&longitude=${round2(lon)}&${OM_UNITS}&models=${models}` +
    '&forecast_hours=48&forecast_days=10' +
    '&hourly=temperature_2m,dew_point_2m,wind_speed_10m,wind_gusts_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,' +
    'wind_speed_10m_max,wind_direction_10m_dominant';
  return cached(`omm:${round2(lat)},${round2(lon)}`, 15 * 60_000, () => getJson<OmModels>(url));
}

/** Rain-soon check: 15-minute precipitation for the past hour and next hour. Cached 10 min. */
export function omMinutely(lat: number, lon: number) {
  const url = `${OM}?latitude=${round2(lat)}&longitude=${round2(lon)}&${OM_UNITS}` +
    '&minutely_15=precipitation&past_minutely_15=4&forecast_minutely_15=4';
  return cached(`omq:${round2(lat)},${round2(lon)}`, 10 * 60_000, () =>
    getJson<{ minutely_15: { time: number[]; precipitation: (number | null)[] } }>(url));
}

/* ------------------------------------------------------------------ */
/*  Air quality: EPA AirNow (if keyed), else Open-Meteo CAMS           */
/* ------------------------------------------------------------------ */

const POLLUTANT_LABEL: Record<string, string> = {
  us_aqi_pm2_5: 'PM2.5', us_aqi_pm10: 'PM10', us_aqi_ozone: 'Ozone', us_aqi_nitrogen_dioxide: 'NO2',
};

export function airQuality(lat: number, lon: number): Promise<{ aqi: number | null; pollutant: string | null }> {
  return cached(`aq:${round2(lat)},${round2(lon)}`, 60 * 60_000, async () => {
    const key = process.env.AIRNOW_API_KEY;
    if (key) {
      try {
        const rows = await getJson<{ ParameterName: string; AQI: number }[]>(
          `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lon}&distance=25&API_KEY=${key}`,
        );
        if (rows.length) {
          const top = rows.reduce((a, b) => (b.AQI > a.AQI ? b : a));
          return { aqi: top.AQI, pollutant: top.ParameterName };
        }
      } catch { /* fall through to CAMS */ }
    }
    const fields = Object.keys(POLLUTANT_LABEL);
    const j = await getJson<{ current: Record<string, number | null> }>(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${round2(lat)}&longitude=${round2(lon)}&current=us_aqi,${fields.join(',')}`,
    );
    let pollutant: string | null = null;
    let best = -1;
    for (const f of fields) {
      const v = j.current[f];
      if (v != null && v > best) { best = v; pollutant = POLLUTANT_LABEL[f]; }
    }
    return { aqi: j.current.us_aqi ?? null, pollutant };
  });
}

/* ------------------------------------------------------------------ */
/*  IEM radar metadata                                                 */
/* ------------------------------------------------------------------ */

export const iemLatestComposite = () =>
  cached('iem:n0q', 60_000, async () =>
    (await getJson<{ meta: { valid: string } }>('https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json')).meta.valid);

export const iemHrrrInit = () =>
  cached('iem:hrrr', 5 * 60_000, async () =>
    (await getJson<{ model_init_utc: string }>('https://mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json')).model_init_utc);
