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
```
Usa comillas **simples** en valores con `$`, `#`, `!` o `%` (Compose no interpola dentro de comillas simples).

> El seed solo **crea** el admin si no existe; no cambia la contraseña de uno existente.

## 2. Levantar
```bash
docker compose up -d --build        # db → migrate (migraciones + seed) → app; reinicio automático
docker compose ps && docker compose logs migrate --tail 30
```
Actualizar a una versión nueva: `git pull` y de nuevo `docker compose up -d --build`. Nunca `down -v` (borra la BD).

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
