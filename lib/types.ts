/**
 * Fairweather shared types — the contract between the forecast API
 * (`/fairweather/api/forecast`) and the client app.
 * All times are ISO 8601 strings with an offset (UTC `Z`); the client formats
 * them in `meta.tz`.
 */

export type Cond = 'clear' | 'pcloudy' | 'cloudy' | 'rain' | 'storm' | 'snow' | 'wind' | 'fog';
export type Source = 'NWS' | 'Model';

export interface NowData {
  observedAt: string;
  /** `ASOS` when a fresh station observation was used, `Model` when Open-Meteo filled in */
  source: 'ASOS' | 'Model';
  station: string | null;
  temp: number | null;
  feelsLike: number | null;
  dewPoint: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windGust: number | null;
  /** Direction the wind blows FROM, degrees */
  windDeg: number | null;
  pressure: number | null;
  pressureTrend: 'up' | 'down' | 'steady' | null;
  /** Hourly sea-level pressure (inHg), oldest first, ending now */
  pressure24: number[];
  visibility: number | null;
  cloudCover: number | null;
  condition: string;
  icon: Cond;
  isDay: boolean;
  uv: number | null;
  uvPeak: number | null;
  uvPeakTime: string | null;
  aqi: number | null;
  aqiPollutant: string | null;
  /** Total precipitation (in) over the past 24 h */
  rain24: number;
  rain24Hourly: number[];
  rain24Start: string;
  high: number | null;
  low: number | null;
  sunrise: string | null;
  sunset: string | null;
}

export interface HourData {
  time: string;
  temp: number;
  dewPoint: number | null;
  pop: number;
  windSpeed: number | null;
  windGust: number | null;
  windDir: string | null;
  condition: string;
  icon: Cond;
  isDay: boolean;
  source: Source;
}

export interface HalfDay {
  /** NWS period name ("Tonight", "Wednesday Night") or "Day"/"Night" for model days */
  name: string;
  temp: number;
  condition: string;
  icon: Cond;
  pop: number;
  wind: string;
  narrative: string;
}

export interface DayData {
  /** Local date, YYYY-MM-DD */
  date: string;
  source: Source;
  day: HalfDay | null;
  night: HalfDay | null;
  /** Model spread for days 8–10: [min, max] across ECMWF, GFS, ICON */
  spread?: { high: [number, number]; low: [number, number] };
  tags: string[];
}

export type AlertLevel = 'warning' | 'watch' | 'advisory' | 'statement';

export interface WxAlert {
  id: string;
  event: string;
  headline: string | null;
  description: string;
  instruction: string | null;
  severity: string;
  level: AlertLevel;
  messageType: string;
  sent: string;
  expires: string | null;
  ends: string | null;
  senderName: string;
  /** Issuing office code from the alert's sender, e.g. `EAX` */
  office: string | null;
  zones: string[];
}

export interface RadarSite {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface ForecastMeta {
  lat: number;
  lon: number;
  tz: string;
  /** NWS forecast office code, e.g. `EAX` */
  office: string | null;
  officeName: string | null;
  place: string | null;
  updated: string;
  gridUpdated: string | null;
  gridStale: boolean;
  radarSite: RadarSite | null;
  zones: string[];
  /** Plain-language problems the UI should surface, e.g. "Couldn't reach NWS. …" */
  errors: string[];
  nwsOk: boolean;
}

export interface ForecastResponse {
  now: NowData;
  hourly: HourData[];
  days: DayData[];
  alerts: WxAlert[];
  summary: string;
  meta: ForecastMeta;
}

export interface RadarManifest {
  /** Newest observed composite frame time */
  latestObs: string;
  stale: boolean;
  /** HRRR run initialization time, or null if unavailable */
  run: string | null;
  runLabel: string | null;
  /** Forecast valid times, 15-minute steps, after `latestObs` */
  forecast: { valid: string; minute: number }[];
  updated: string;
}

export interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

export type AlertMin = 'advisory' | 'watch' | 'warning';

export interface PushPrefs {
  alertMin: AlertMin;
  rainSoon: boolean;
  /** 'HH:MM' local, or null for off */
  briefTime: string | null;
  quietStart: string;
  quietEnd: string;
}
