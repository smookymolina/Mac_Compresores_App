# Despliegue del portal de socios (v1.4.0)

El portal vive en **https://maccompresores.app/socios** (mismo dominio y mismo contenedor `app`; sin subdominio, sin DNS nuevo, sin certbot).
Admin interno: `/socios-admin` (requiere `mac_session` y permiso `partners.manage`).
Todo se hace desde el VPS, con el `.env` de producción, en `/opt/maccompresores`. Nada de despliegues desde laptop.

## 0. Variables nuevas
| Variable | Valor | Notas |
|---|---|---|
| `PARTNER_TOKEN_SECRET` | `openssl rand -hex 32` | firma de tokens del portal |
| `PARTNER_TOTP_KEY` | `openssl rand -hex 32` | AES-256-GCM de los secretos TOTP. **Si se pierde o cambia, todos los socios rehacen su 2FA.** Guardarla también fuera del servidor. |

Los valores ya generados están en `/root/.env.partners.pending` (chmod 600, fuera del repo). `docker-compose.prod.yml` ya pasa ambas al servicio `app` (bloque `environment`; no usa `env_file`).
No hay `PARTNER_PORTAL_HOST` (obsoleta por el cambio a ruta).

## 1. Orden de despliegue
```sh
cd /opt/maccompresores
git status --short                      # debe estar limpio; checkout de release/v1.2.0 con el commit v1.4.0
F=respaldo_pre_v140_$(date +%F_%H%M).sql.gz
docker compose -f docker-compose.prod.yml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$F"
gunzip -t "$F" && ls -l "$F"            # respaldo manual verificado ANTES de tocar nada

cp .env ".env.bak_pre_v140"             # copia del .env (contiene secretos: no subir al repo)
grep '^PARTNER_' /root/.env.partners.pending >> .env    # no imprimir el resultado
grep -c '^PARTNER_' .env                # debe dar 2 (si da 4, ya estaban: duplicado; limpiar)

sh scripts/deploy.sh
```
- `scripts/deploy.sh` **no llama `prisma migrate deploy` directamente**: hace otro respaldo (`respaldo_pre_deploy_*`) y `up -d --build app`; `app` depende de `migrate` (target `migrator`: `npx prisma migrate deploy && npx prisma db seed`), así que compose reconstruye y ejecuta la migración `20261013000000_partner_portal` antes de arrancar `app`. Comprobarlo siempre:
  ```sh
  docker compose -f docker-compose.prod.yml logs migrate --tail 40    # debe decir "Applying migration 20261013000000_partner_portal"
  ```
  Si no la aplicó: `docker compose -f docker-compose.prod.yml run --rm migrate`.
- El seed crea `Setting` `partners.discountPct`=15 y `partners.dailyQuota`=80 con `update:{}` (no pisa cambios del admin).
- Esperar "App healthy." (healthcheck en `/login`).
- Tras confirmar: `shred -u /root/.env.partners.pending` (y guardar `PARTNER_TOTP_KEY` en el gestor de contraseñas).

## 2. nginx (reescritura mínima del server existente)
Fuente: `docs/nginx-socios.conf` (dos partes separadas por la línea `==== CORTE`). Validada con `nginx -t` en `nginx:1.27-alpine` (el host usa 1.28.3).
```sh
cd /opt/maccompresores
sudo cp -a /etc/nginx/sites-available/maccompresores /root/nginx_maccompresores.bak_pre_v140   # respaldo del archivo
sed -n '1,/^# ==== CORTE/p' docs/nginx-socios.conf | sudo tee /etc/nginx/conf.d/socios-zones.conf >/dev/null          # parte A (http{})
sudo mkdir -p /etc/nginx/snippets
sed -n '/^# ==== CORTE/,$p' docs/nginx-socios.conf | sudo tee /etc/nginx/snippets/socios-locations.conf >/dev/null   # parte B
```
Editar `/etc/nginx/sites-available/maccompresores` y añadir, **dentro del `server` con `listen 443 ssl`**, justo antes de `location / {`:
```nginx
    include /etc/nginx/snippets/socios-locations.conf;
```
```sh
sudo nginx -t && sudo systemctl reload nginx
```
No usar `location ^~ /socios` sin barra: atraparía `/socios-admin`. El snippet usa `= /socios` y `^~ /socios/`.
`/socios/p/` tiene zona propia (120 r/m, burst 40) porque una búsqueda trae hasta 20 PNG; el resto de `/socios` es 30 r/m burst 10 por IP (429). Para un límite único, cambiar su zona a `mac_partner_req`.
Nota: el cliente de prueba `curl`/`HeadlessChrome`/UA vacío recibe 403 en `/socios`; las verificaciones de abajo con `curl` usan `-A "Mozilla/5.0"`.

## 3. Verificación post-deploy
```sh
UA='Mozilla/5.0 (X11; Linux x86_64)'
# a) app directa (antes/sin nginx)
curl -s -o /dev/null -w '%{http_code}\n' -A "$UA" http://127.0.0.1:3080/socios/login          # 200
# b) público
curl -sI -A "$UA" https://maccompresores.app/socios/login | grep -i -E 'HTTP/|content-security-policy|x-robots-tag|cache-control|referrer-policy|strict-transport'
#    esperado: 200, CSP estricta, X-Robots-Tag noindex, Cache-Control no-store, Referrer-Policy no-referrer, HSTS
curl -s https://maccompresores.app/robots.txt | grep -i socios                                  # Disallow: /socios
# c) bloqueos nginx
curl -s -o /dev/null -w '%{http_code}\n' https://maccompresores.app/socios/login                # curl por defecto -> 403
curl -s -o /dev/null -w '%{http_code}\n' -A '' https://maccompresores.app/socios/login          # UA vacío -> 403
for i in $(seq 1 15); do curl -s -o /dev/null -w '%{http_code} ' -A "$UA" https://maccompresores.app/socios/login; done; echo   # tras ~11 -> 429
# d) cruces / sin sesión (esperar 404 o redirección a login, nunca datos)
curl -s -o /dev/null -w '%{http_code}\n' -A "$UA" https://maccompresores.app/socios/api-precios      # honeypot: sin datos
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -A "$UA" https://maccompresores.app/socios-admin   # redirige al login interno (/login), NO al de socios
curl -s -o /dev/null -w '%{http_code}\n' -A "$UA" https://maccompresores.app/socios/p/token-falso     # 404
# e) la app interna sigue igual
curl -s -o /dev/null -w '%{http_code}\n' -A "$UA" https://maccompresores.app/login                    # 200, sin rate limit de socios
# f) cabecera X-Forwarded-Host no falsificable (nginx la sobrescribe con $host)
curl -s -o /dev/null -w '%{http_code}\n' -A "$UA" -H 'X-Forwarded-Host: evil.example' https://maccompresores.app/socios/login
# g) funcional: alta de un socio de prueba en /socios-admin, login + registro TOTP, búsqueda, PNG; bloquear y revocar sesiones.
docker compose -f docker-compose.prod.yml logs app --tail 50 | grep -i -E 'error|partner' ; sudo tail -n 20 /var/log/nginx/error.log
```
Las cookies del socio (`__Secure-mac_partner`, Path=/socios) no deben aparecer en `/login` ni en `/socios-admin`.

## 4. ROLLBACK (de menor a mayor impacto)
**A. Solo nginx (el portal deja de ser accesible; la app interna no se toca):**
```sh
sudo cp -a /root/nginx_maccompresores.bak_pre_v140 /etc/nginx/sites-available/maccompresores   # o borrar la línea include
sudo rm -f /etc/nginx/conf.d/socios-zones.conf /etc/nginx/snippets/socios-locations.conf
sudo nginx -t && sudo systemctl reload nginx
```
**B. Código (volver a la versión anterior):**
```sh
cd /opt/maccompresores
git log --oneline -5                     # localizar el commit v1.4.0
git revert --no-edit <hash_v1.4.0>       # (o git checkout <hash_anterior> en el VPS si no hay push)
cp .env.bak_pre_v140 .env                # quita PARTNER_* (opcional; son inertes sin el código)
sh scripts/deploy.sh                     # reconstruye la imagen anterior y espera "healthy"
```
Si la imagen anterior arranca con la BD nueva no hay problema: las tablas nuevas son aditivas y el código viejo no las usa.

**C. Base de datos (solo si hay que eliminar el esquema del portal; destruye socios, sesiones, actividad y ajustes):**
```sh
docker compose -f docker-compose.prod.yml exec -T db psql -U mac -d mac_compresores -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
DROP TABLE "PartnerActivity","PartnerSession","Partner","Setting";
DROP TYPE "PartnerActivityType","PartnerStatus";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261013000000_partner_portal';
COMMIT;
SQL
```
Ejecutar **después** de B (si no, el contenedor `migrate` de la versión nueva volvería a crearlas). El `DELETE` evita que Prisma crea aplicada una migración que ya no existe.

**D. Restauración total desde el respaldo (último recurso; pierde todo lo escrito después del respaldo):**
```sh
C="docker compose -f docker-compose.prod.yml"
$C stop app scheduler
$C exec -T db psql -U mac -d postgres -c 'DROP DATABASE mac_compresores' -c 'CREATE DATABASE mac_compresores OWNER mac'
gunzip -c respaldo_pre_v140_<fecha>.sql.gz | $C exec -T db psql -U mac -d mac_compresores -v ON_ERROR_STOP=1
$C up -d app scheduler
```
(`pg_dump` en texto plano no incluye `--clean`; restaurar sobre una BD con datos fallaría, por eso se recrea.)
