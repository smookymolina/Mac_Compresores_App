# Reversión

- **App (v1.3.7):** `git revert` del commit o redeploy de v1.3.6 (`git checkout 70ce4eb && docker compose -f docker-compose.prod.yml up -d --build app`). El SVG es un archivo estático; quitarlo no afecta el correo.
- **Reply-To:** definir `MAIL_REPLY_TO` en `.env` del VPS y recrear `app`; o revertir `companyReplyTo()`.
- **DNS BIMI (si se publica):** eliminar el TXT `default._bimi`. No afecta entrega.
- **DKIM/DMARC:** no se modificaron. Si en el futuro se cambian, conservar el valor previo anotado en `dns-audit.md`.
