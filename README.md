# Fairweather

Personal, ad-free, no-login weather PWA at **openglades.com/fairweather**. Built from the
Prairie Sky build spec and mock, with a Next.js server in place of the spec's Cloudflare
Worker and a server crontab in place of Worker cron triggers.

Pages: **Now**, **Hourly** (24 h), **10-Day**, **Radar** (past 2/6/24 h plus HRRR forecast).
Eleven Kansas City color themes, light/dark/auto. Saved locations and settings live in
`localStorage`; the only server state is push subscriptions in `data/fairweather.db`.

## Run locally

Use Node 20 to 25 (`.node-version` says 24; better-sqlite3 has no Node 26 build yet).

```sh
npm install
cp env.sample .env.local     # Mapbox token + optional light/dark map styles for the Radar page
npm run dev                  # http://localhost:3100/fairweather
npm run typecheck
npm run contrast             # WCAG check for all 22 palettes
```

To see it inside the Open Glades site locally, also run `node ../server/dev-server.mjs`
and open http://localhost:8123/fairweather (the dev server proxies to :3100 like nginx).

Deployment: `../deploy/DEPLOYMENT.md`, section 4.

## Layout

```
app/
  layout.tsx, page.tsx      root layout (fonts, PWA metadata, theme bootstrap), single page
  components/               FairweatherApp shell + Now, Hourly, TenDay, Radar pages, sheets, icons
  lib/                      client: storage wrapper, themes, formatting, push client, basePath
  api/                      forecast, alerts, geocode, radar/manifest, push/*, cron/[job]
lib/                        server: NWS/Open-Meteo fetchers, forecast merge, radar manifest,
                            SQLite, web push, cron jobs; themes.json; shared types
public/                     sw.js (offline + push), manifest.webmanifest, icons/
scripts/                    cron.sh (crontab entry point), contrast.mjs
```

Everything is served under `basePath: '/fairweather'` (next.config.ts). `fetch()` calls go
through `app/lib/base.ts` because Next does not prefix those.

## Data

| What | Source | Notes |
|------|--------|-------|
| Now | Nearest NWS stations (up to 4 within 40 km): best of distance and report age, blended with stations within 25 km reporting at about the same time; used when under 3 h old, else Open-Meteo | Blank API fields are filled from the raw METAR. The forecast nudge only uses readings under 80 min old. When ASOS says "Clear" but the NWS grid shows 60%+ sky cover (high clouds ASOS can't see), the current-hour NWS condition is used |
| Hourly | Blend: NWS hourly 0.55, NBM 0.25, HRRR 0.15 (moves to NBM after h18), ECMWF 0.05; gusts from the NWS grid | NBM/HRRR/ECMWF come from Open-Meteo's `models=`. Observation nudge on temp and dew point for hours 0 to 5. Stale grid (over 6 h) drops NWS weight for hours 1 to 12 |
| Days 1 to 7 | NWS forecast periods, verbatim | |
| Days 8 to 10 | Mean of ECMWF, GFS, ICON (whichever reach that day) with spread | If NWS is down, all 10 days are Model and the UI says so |
| Alerts | NWS `/alerts/active` | |
| AQI | EPA AirNow if `AIRNOW_API_KEY`, else CAMS via Open-Meteo | |
| Radar, observed | IEM NEXRAD N0Q composite archive (5-min mosaics) | Base reflectivity; one national mosaic covering the lower 48, Alaska, Hawaii, and Puerto Rico |
| Radar, observed precip type | NOAA MRMS `PrecipFlag` + `MergedBaseReflectivityQC` from AWS (`noaa-mrms-pds`), lower 48, Alaska, Hawaii | Rendered to tiles by this server (`lib/mrms.ts`, GRIB2 template 5.41 decoded with `lib/png.ts`): rain greens to red, snow blues, rain with hail pink |
| Radar, forecast | IEM HRRR tiles (`REFD`, `REFP` for precip type), pinned to the newest complete run | Lower 48 only; never mixes runs |

Server responses are cached in memory (forecast 10 min, points 24 h, alerts 2 min).

Radar tiles go through `/fairweather/api/radar/tile/...`, which stores each IEM tile on disk
(`data/tiles`) and serves it immutable. The `radar` cron job pre-fetches the default 2 h loop and
first 6 h of forecast around Kansas City and subscribers' saved places, and prunes frames older than
25 h and all but the newest two HRRR runs. The Radar page adds frames to the map a few at a time,
Now first.

## Push

Standard Web Push via `web-push` with VAPID keys from `.env.local`. The browser's subscription
is its identity and its `auth` secret is the credential for prefs/unsubscribe/test.
`scripts/cron.sh` calls `POST /fairweather/api/cron/{alerts|rain|cleanup}` with
`FAIRWEATHER_CRON_SECRET`; nginx blocks that path from outside.

- **alerts** (every 2 min): new NWS alerts for any saved location's forecast/county zone, at or above the
  user's threshold. The deliveries table dedupes, so a replay never sends twice. Quiet hours hold
  everything except Severe/Extreme warnings; held alerts go out after quiet hours if still active.
- **rain** (every 15 min): "Rain soon" from Open-Meteo `minutely_15` for the primary (first) location,
  3 h cooldown, plus the morning brief once per local day.
- **radar** (every 5 min): radar tile cache prewarm and prune (see Data).
- **cleanup** (daily): 404/410 deletes immediately on send; this sweep removes dead (10+ failures over
  7 days) and abandoned (120 days unseen, no success in 30) subscriptions and prunes old rows.

## Differences from the build spec

- No Cloudflare: Next.js API routes + SQLite + crontab on the existing server.
- No separate radar job. Reflectivity uses IEM tiles; observed precip type is decoded from MRMS GRIB2 on
  demand in the app server. The Composite and 1-hr rain layers are not
  offered (IEM's MRMS 1-hr tiles paint no-data areas opaque gray). Observed frames are 10 min
  apart for 2 h/6 h and 30 min for 24 h; forecast frames are 30 min apart, to keep phone GPU
  memory reasonable. Change `OBS_STEP_MIN` / `FCST_STEP_MIN` in `RadarPage.tsx`.
- HRRR forecast tiles use IEM's color table, which differs slightly from the observed ramp.
- 0 to 2 h rain uses Open-Meteo `minutely_15` (the spec's fallback) rather than a pySTEPS nowcast.
- No verification log or weight tuning yet; starting weights are fixed.
- Three palettes failed the WCAG 4.5:1 check for text on the accent color (Prairie Sky light,
  Sprout Track light, Monarchs dark); their `onAccent` was changed to a dark ink.
