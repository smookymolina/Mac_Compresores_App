#!/bin/sh
# Respaldo diario de PostgreSQL: pg_dump comprimido en /backups, conserva BACKUP_KEEP_DAYS días.
# Corre dentro del contenedor "backup" (imagen postgres): PGHOST/PGUSER/PGPASSWORD/PGDATABASE vienen del entorno.
set -eu
KEEP="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_HOUR_UTC:-9}" # 09:00 UTC = 03:00 en la Ciudad de México

backup() {
  f="/backups/${PGDATABASE}_$(date -u +%Y-%m-%d_%H%M).sql.gz"
  if pg_dump --no-owner --no-privileges | gzip > "$f.tmp"; then
    mv "$f.tmp" "$f"
    echo "[backup] ok $f ($(du -h "$f" | cut -f1))"
    find /backups -name "${PGDATABASE}_*.sql.gz" -mtime +"$KEEP" -delete
  else
    rm -f "$f.tmp"
    echo "[backup] ERROR al respaldar" >&2
  fi
}

until pg_isready -q; do sleep 2; done
backup # uno al arrancar, para no depender de la primera ventana
while true; do
  now=$(date -u +%s)
  next=$(date -u -d "$(date -u +%Y-%m-%d) ${HOUR}:00:00" +%s 2>/dev/null || echo 0)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
  backup
done
