#!/bin/bash
# Fairweather scheduled jobs. Calls the running Fairweather service (openglades-fairweather).
#
# crontab -e on the server (as the service user):
#   */2 * * * *   /srv/jroverton.com/open-glades/fairweather/scripts/cron.sh alerts
#   */15 * * * *  /srv/jroverton.com/open-glades/fairweather/scripts/cron.sh rain
#   17 3 * * *    /srv/jroverton.com/open-glades/fairweather/scripts/cron.sh cleanup
#   */5 * * * *   /srv/jroverton.com/open-glades/fairweather/scripts/cron.sh radar
#
# Reads FAIRWEATHER_CRON_SECRET (and optional FAIRWEATHER_BASE_URL) from .env.local next to package.json.

set -euo pipefail
cd "$(dirname "$0")/.."

JOB="${1:?usage: cron.sh alerts|rain|cleanup|radar}"
SECRET="$(grep -E '^FAIRWEATHER_CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '"')"
BASE="$(grep -E '^FAIRWEATHER_BASE_URL=' .env.local | cut -d= -f2- | tr -d '"' || true)"
BASE="${BASE:-http://127.0.0.1:3100}"

curl -fsS -m 290 -X POST -H "Authorization: Bearer ${SECRET}" "${BASE}/fairweather/api/cron/${JOB}"
echo
