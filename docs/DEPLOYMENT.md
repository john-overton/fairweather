# Deploying Fairweather

Fairweather is one Node service on `127.0.0.1:3100`, behind nginx at the `/fairweather` path of an
existing site. It serves the API (Hono) and the built app (Vite, in `dist/web`), and runs its own
scheduled jobs: alerts, rain-soon and morning-brief notifications, radar prewarming, and cleanup.
State lives in `data/` (SQLite for push subscriptions, and NWS zone outlines for the radar's
warnings). Radar tiles are cached in `/var/cache/fairweather/tiles` (`FAIRWEATHER_TILE_DIR`, set in the
service unit).

The paths below assume the app lives at `/var/www/fairweather` and runs as `www-data`. Adjust
`deploy/fairweather.service` if yours differ.

## 1. Requirements

- Node 22.12 to 25 (better-sqlite3 has no Node 26 build yet) and nginx.
- About 300 MB of free RAM while decoding radar frames, and about 100 MB of disk for the tile cache.

## 2. Install and build

```sh
sudo git clone https://github.com/john-overton/fairweather.git /var/www/fairweather
cd /var/www/fairweather
sudo npm ci
sudo cp env.sample .env.local
sudo nano .env.local
sudo npm run build             # VITE_* values are baked in here; rebuild if they change
sudo install -d -o www-data -g www-data data
sudo chown root:www-data .env.local && sudo chmod 640 .env.local
```

`npm run build` writes `dist/web` (the app) and `dist/server` (the bundled server and job runner).

`.env.local` keys (see `env.sample` for every optional setting and its default):

| key | meaning |
|-----|---------|
| `VITE_MAPBOX_TOKEN` | Mapbox public token for the Radar page; add your domain to its URL restrictions |
| `VITE_MAPBOX_STYLE_LIGHT` / `VITE_MAPBOX_STYLE_DARK` | Mapbox style URLs for the radar's Day and Night basemaps (blank: stock light-v11 / dark-v11) |
| `FAIRWEATHER_VAPID_PUBLIC_KEY` / `FAIRWEATHER_VAPID_PRIVATE_KEY` | Web Push keys from `npx web-push generate-vapid-keys`. Generate once; changing them invalidates every subscription |
| `FAIRWEATHER_VAPID_SUBJECT` | `mailto:` contact sent to push services |
| `FAIRWEATHER_SCHEDULE_*`, `FAIRWEATHER_JOBS` (optional) | job schedules in cron syntax, or `FAIRWEATHER_JOBS=off` to run none |
| `FAIRWEATHER_DEFAULT_*` (optional) | first-visit location and new subscribers' notification settings |
| `FAIRWEATHER_RETAIN_*_DAYS` (optional) | how long cleanup keeps deliveries, seen alerts, and inactive subscriptions |
| `FAIRWEATHER_USER_AGENT` (optional) | User-Agent for NWS requests; NWS asks for contact info |
| `AIRNOW_API_KEY` (optional) | EPA AirNow; falls back to CAMS air quality without it |

The `FAIRWEATHER_*` settings are read when the service starts, so changing them needs only a restart.

## 3. Service

```sh
sudo cp deploy/fairweather.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fairweather
curl -s http://127.0.0.1:3100/fairweather/api/radar/manifest | head -c 200   # -> {"latestObs":...}
journalctl -u fairweather -f      # startup lists the job schedules; each run logs one line
```

To run a job by hand (for example, to send the morning brief now if it is due), as a user that can
read `.env.local` and write `data/`:

```sh
cd /var/www/fairweather && sudo -u www-data node --enable-source-maps dist/server/job.mjs rain    # alerts | rain | radar | cleanup
```

## 4. nginx

Paste `deploy/nginx-fairweather.conf` inside the `server { }` block of the site that should host
`/fairweather`, then:

```sh
sudo nginx -t && sudo systemctl reload nginx
curl -I https://your.site/fairweather      # 200
```

Behind a CDN or proxy, that's fine as is: the app marks the page `no-cache`, location-specific API
responses `private`, and versioned assets and radar tiles `immutable`.

To serve from a path other than `/fairweather`, change `base` in `vite.config.ts`, the base path in
`server/app.ts`, `BASE` in `public/sw.js`, and the paths in `public/manifest.webmanifest`.

## Updating

```sh
cd /var/www/fairweather
sudo git pull
sudo npm ci && sudo npm run build
sudo systemctl restart fairweather
```

### Moving from the Next.js version

The Next.js build used a crontab and `NEXT_PUBLIC_*` keys. When updating past it:

1. Rename `NEXT_PUBLIC_MAPBOX_TOKEN`, `NEXT_PUBLIC_MAPBOX_STYLE_LIGHT` and `NEXT_PUBLIC_MAPBOX_STYLE_DARK`
   to `VITE_MAPBOX_*` in `.env.local`, and delete `FAIRWEATHER_CRON_SECRET` and `FAIRWEATHER_BASE_URL`.
2. Remove the four `scripts/cron.sh` lines from the crontab (the jobs now run in the service).
3. Install the new `deploy/fairweather.service`, then `daemon-reload`.
4. Remove the `location ^~ /fairweather/api/cron/ { return 404; }` line from nginx (harmless if left).
5. `sudo rm -rf .next` after the first successful build.
