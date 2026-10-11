#!/bin/sh
# Despliegue en el VPS: respaldo → build + migraciones → espera "healthy" → limpieza de Docker.
# Uso: sh scripts/deploy.sh   (desde la raíz del proyecto, con .env de producción)
set -eu
cd "$(dirname "$0")/.."
C="docker compose -f docker-compose.prod.yml"

F="respaldo_pre_deploy_$(date +%F_%H%M).sql.gz"
$C exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$F"
gunzip -t "$F" && echo "Respaldo: $F"

$C up -d --build app

i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$($C ps -q app)")" = healthy ]; do
  i=$((i + 1)); [ $i -gt 60 ] && { echo "La app no quedó healthy; revisa: $C logs app"; exit 1; }
  sleep 3
done
echo "App healthy."

# Cada --build deja capas en el caché (decenas de GB con el tiempo). Se regeneran solas.
docker builder prune -af >/dev/null
docker image prune -f >/dev/null
df -h / | tail -1
