#!/bin/sh
# Dispara el trabajo diario de la app (vencimientos, recordatorios, alertas de stock) a CRON_HOUR_UTC.
set -eu
HOUR="${CRON_HOUR_UTC:-13}" # 13:00 UTC = 07:00 en la Ciudad de México

run() {
  if curl -fsS -m 120 -X POST -H "Authorization: Bearer ${CRON_SECRET}" "${APP_INTERNAL_URL:-http://app:3000}/api/cron/daily"; then
    echo " [scheduler] ok $(date -u +%FT%TZ)"
  else
    echo "[scheduler] ERROR $(date -u +%FT%TZ)" >&2
  fi
}

if [ -z "${CRON_SECRET:-}" ]; then
  echo "[scheduler] CRON_SECRET vacío: trabajo diario desactivado" >&2
  while true; do sleep 86400; done
fi

while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) ${HOUR}:00:00" +%s 2>/dev/null || echo 0)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  run
done
