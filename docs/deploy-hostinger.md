# Despliegue en VPS (Hostinger) · maccompresores.app

Stack: Next.js 15 + Prisma + PostgreSQL 16, todo con Docker Compose. Nginx en el host hace de proxy
inverso con HTTPS (Let's Encrypt). La BD es un contenedor local (volumen `pgdata`): no requiere servicios externos.

## 1. Código y variables
```bash
git clone https://github.com/smookymolina/Mac_Compresores_App.git /opt/mac-compresores
cd /opt/mac-compresores
cp .env.example .env && chmod 600 .env
```
Edita `.env` (nunca lo subas al repositorio):
```dotenv
POSTGRES_PASSWORD='<contraseña larga aleatoria>'
SEED_ADMIN_EMAIL='admin@maccompresores.com.mx'
SEED_ADMIN_PASSWORD='<contraseña del admin>'
SEED_DEMO=0
APP_URL='https://maccompresores.app'
APP_PORT='127.0.0.1:3080'        # solo accesible vía Nginx
COOKIE_SECURE=true
SMTP_HOST='smtp.hostinger.com'
SMTP_PORT=465
SMTP_USER='contacto@maccompresores.com.mx'
SMTP_PASS='<contraseña del buzón>'
SMTP_FROM_NAME='Mac Compresores'
SMTP_FROM_EMAIL='contacto@maccompresores.com.mx'
CRON_SECRET='<openssl rand -hex 32>'
BANK_INFO='Banco: …|Titular: …|Cuenta: …|CLABE: …'
BACKUP_KEEP_DAYS=14
```
Usa comillas **simples** en valores con `$`, `#`, `!` o `%` (Compose no interpola dentro de comillas simples).

> El seed solo **crea** el admin si no existe; no cambia la contraseña de uno existente.

## 2. Levantar
> En el VPS de producción se usa `docker-compose.prod.yml` (Postgres sin puerto publicado, app solo en
> 127.0.0.1:3080): antepón `-f docker-compose.prod.yml` a cada comando `docker compose` de esta guía.

```bash
docker compose up -d --build        # db → migrate (migraciones + seed) → app; reinicio automático
docker compose ps && docker compose logs migrate --tail 30
```
Actualizar a una versión nueva: `git pull` y de nuevo `docker compose up -d --build`. Nunca `down -v` (borra la BD).

Servicios que levanta Compose: `db`, `migrate` (migraciones + seed, una vez), `app`, `backup` (respaldo diario
03:00 de México en `./backups`, conserva `BACKUP_KEEP_DAYS` días) y `scheduler` (trabajo diario 07:00 de México:
vence cotizaciones, recuerda las que vencen en 3 días, avisa stock bajo mínimo y cobro vencido).

### Respaldos
- Listar: `ls -lh backups/` · Forzar uno ahora: `docker compose restart backup` (respalda al arrancar).
- Restaurar (¡reemplaza los datos!):
  ```bash
  docker compose stop app scheduler
  gunzip -c backups/<archivo>.sql.gz | docker compose exec -T db psql -U mac -d mac_compresores -v ON_ERROR_STOP=1 \
    -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' -f -
  docker compose start app scheduler
  ```
- Copia fuera del VPS (recomendado): sincroniza `./backups` a otro almacenamiento, p. ej. con `rclone` en un cron
  del host (`rclone sync /opt/mac-compresores/backups remoto:mac-backups`) o con los respaldos del panel de Hostinger.

### Trabajo diario
Probar manualmente: `docker compose exec scheduler sh -c 'curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://app:3000/api/cron/daily'`

## 3. Nginx (`/etc/nginx/sites-available/maccompresores.app`)
```nginx
server {
    listen 80;
    server_name maccompresores.app www.maccompresores.app;
    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 10m;
    }
}
```
```bash
ln -s /etc/nginx/sites-available/maccompresores.app /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## 4. HTTPS (Certbot)
Los registros DNS A de `maccompresores.app` y `www` deben apuntar a la IP del VPS.
```bash
certbot --nginx -d maccompresores.app -d www.maccompresores.app \
  -m contacto@maccompresores.com.mx --agree-tos --redirect -n
```
Para que `www` redirija al dominio principal, en el bloque `server` HTTPS que crea Certbot agrega:
```nginx
if ($host = www.maccompresores.app) { return 301 https://maccompresores.app$request_uri; }
```
Firewall: abre solo 22, 80 y 443 (`ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable`).

## 5. Verificar
- `curl -I https://maccompresores.app/login` → `200`; `http://` y `www` → `301` a `https://maccompresores.app`.
- En `/recuperar`, solicita el enlace para el correo del admin: debe llegar desde `contacto@maccompresores.com.mx`.
  Si no llega: `docker compose logs app | grep '\[mail\]'`.
