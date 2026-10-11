# Identidad visual y autenticación de correo — MAC Compresores

**Objetivo:** que el logotipo de MAC Compresores pueda mostrarse junto al remitente en buzones compatibles (BIMI) sin alterar el envío actual.

## Arquitectura actual (verificada 2026-10-11)
- Envío: `src/lib/mail.ts` (Nodemailer) → Titan/GoDaddy `smtpout.secureserver.net:465` TLS implícito, certificados validados.
- From: `SMTP_FROM_NAME <SMTP_FROM_EMAIL>` = `MAC Compresores <ventas@maccompresores.com.mx>`.
- Reply-To: `companyReplyTo()` = `MAIL_REPLY_TO` o, si falta, `SMTP_FROM_EMAIL` (cotizaciones y cobranza; reportes internos usan el correo del usuario).
- Flujos: cotizaciones (`modules/quotes/email.ts`), recuperación/alta de contraseña (`modules/auth/service.ts`, `auth/notify.ts`), recordatorios de cobranza (`modules/payments/reminder.ts`), reportes (`modules/reports/send.ts`), tareas diarias (`modules/jobs/daily.ts`).
- Despliegue: Docker Compose (`docker-compose.prod.yml`, servicios `migrate` → `app`), VPS, Caddy/TLS Let's Encrypt en `maccompresores.app`.

Nombre visible, From, Reply-To, avatar y BIMI son cosas distintas: el nombre visible **no** hace que aparezca un logotipo; BIMI exige DMARC en aplicación + registro DNS + SVG Tiny PS + (en Gmail/Apple) certificado VMC/CMC.

## Recursos generados
| Archivo | Uso |
|---|---|
| `public/email-branding/mac-compresores-bimi.svg` | Logotipo SVG Tiny PS (vectorizado del PNG oficial) |
| `docs/email-branding/assets/mac-compresores-original-drive.png` | Original de Drive sin modificar (1254×1254 RGB, sha256 `ff86dbfeb47e3631…`) |
| `docs/email-branding/assets/bimi-preview-400.png` | Render de control |

URL pública (activa tras desplegar v1.3.7): `https://maccompresores.app/email-branding/mac-compresores-bimi.svg` (excluida del middleware de sesión; `Content-Type: image/svg+xml`).

## Documentos
[dns-audit](dns-audit.md) · [dns-proposed-changes](dns-proposed-changes.md) · [bimi-requirements](bimi-requirements.md) · [validation-report](validation-report.md) · [test-results](test-results.md) · [rollback](rollback.md)

## Variables relevantes (sin valores)
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (secreto, solo `.env` del VPS), `SMTP_FROM_NAME`, `SMTP_FROM_EMAIL`, `MAIL_REPLY_TO` (opcional).

## Riesgos y limitaciones
- El logotipo es un PNG raster vectorizado; para un certificado VMC/CMC conviene el vectorial oficial del diseñador.
- Selector DKIM de Titan sin confirmar (ver auditoría).
- Ningún proveedor garantiza mostrar el logotipo aun cumpliendo requisitos.
