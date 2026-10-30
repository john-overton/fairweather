# Deploying Fairweather

Fairweather is a Next.js app that runs as a Node service on `127.0.0.1:3100`, behind nginx at the
`/fairweather` path of an existing site. A crontab drives alerts, rain-soon notifications, and the
radar tile cache. State lives in `data/` (SQLite for push subscriptions, and NWS zone outlines for the
radar's warnings). Radar tiles are cached in `/var/cache/fairweather/tiles` (`FAIRWEATHER_TILE_DIR`,
set in the service unit), outside the app so builds don't have to scan them.

The paths below assume the app lives at `/var/www/fairweather` and runs as `www-data`. Adjust
`deploy/fairweather.service` if yours differ.

## 1. Requirements

- Node 20 to 25 (better-sqlite3 has no Node 26 build yet) and nginx.
- About 300 MB of free RAM while decoding radar frames, and about 100 MB of disk for the tile cache.

## 2. Install and build

```sh
sudo git clone https://github.com/john-overton/fairweather.git /var/www/fairweather
cd /var/www/fairweather
sudo npm ci
sudo cp env.sample .env.local
sudo nano .env.local
sudo npm run build             # NEXT_PUBLIC_* values are baked in here; rebuild if they change
sudo install -d -o www-data -g www-data data
sudo chown -R www-data:www-data .next
sudo chown root:www-data .env.local && sudo chmod 640 .env.local
```

`.env.local` keys (see `env.sample`):

| key | meaning |
|-----|---------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox public token for the Radar page; add your domain to its URL restrictions |
| `NEXT_PUBLIC_MAPBOX_STYLE_LIGHT` / `NEXT_PUBLIC_MAPBOX_STYLE_DARK` | Mapbox style URLs for the radar's Day and Night basemaps (blank: stock light-v11 / dark-v11) |
| `FAIRWEATHER_VAPID_PUBLIC_KEY` / `FAIRWEATHER_VAPID_PRIVATE_KEY` | Web Push keys from `npx web-push generate-vapid-keys`. Generate once; changing them invalidates every subscription |
| `FAIRWEATHER_VAPID_SUBJECT` | `mailto:` contact sent to push services |
| `FAIRWEATHER_CRON_SECRET` | shared secret between the crontab and the app (`openssl rand -hex 32`) |
| `FAIRWEATHER_USER_AGENT` (optional) | User-Agent for NWS requests; NWS asks for contact info |
| `AIRNOW_API_KEY` (optional) | EPA AirNow; falls back to CAMS air quality without it |

## 3. Service

```sh
sudo cp deploy/fairweather.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fairweather
curl -s http://127.0.0.1:3100/fairweather/api/radar/manifest | head -c 200   # -> {"latestObs":...}
```

## 4. Crontab

```sh
sudo crontab -e
#   */2 * * * *   /var/www/fairweather/scripts/cron.sh alerts   >/dev/null 2>&1
#   */15 * * * *  /var/www/fairweather/scripts/cron.sh rain     >/dev/null 2>&1
#   */5 * * * *   /var/www/fairweather/scripts/cron.sh radar    >/dev/null 2>&1
#   17 3 * * *    /var/www/fairweather/scripts/cron.sh cleanup  >/dev/null 2>&1
```

`cron.sh` reads `FAIRWEATHER_CRON_SECRET` from `.env.local` and calls the app on `127.0.0.1:3100`
(override with `FAIRWEATHER_BASE_URL`). Run it as a user that can read `.env.local`.

## 5. nginx

Paste `deploy/nginx-fairweather.conf` inside the `server { }` block of the site that should host
`/fairweather`, then:

```sh
sudo nginx -t && sudo systemctl reload nginx
curl -I https://your.site/fairweather      # 200
```

The block returns 404 for `/fairweather/api/cron/` so only the local crontab can trigger jobs. Behind a
CDN or proxy, that's fine as is: the app marks the page `no-store`, location-specific API responses
`private`, and versioned assets and radar tiles `immutable`.

To serve from a path other than `/fairweather`, change `BASE_PATH` in `next.config.ts`, `BASE` in
`public/sw.js`, and the paths in `public/manifest.webmanifest`.

## Updating

```sh
cd /var/www/fairweather
sudo git pull
sudo npm ci && sudo npm run build
sudo chown -R www-data:www-data .next
sudo systemctl restart fairweather
```
