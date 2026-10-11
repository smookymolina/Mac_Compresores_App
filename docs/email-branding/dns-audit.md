# Auditoría DNS — maccompresores.com.mx

- **Fecha:** 2026-10-11 21:16 UTC · **Método:** `dig +short` (solo lectura) desde el VPS; `openssl s_client`; `curl -I`.

| Registro | Valor observado | Evaluación |
|---|---|---|
| NS | `ns67/ns68.domaincontrol.com` (SOA `dns.jomax.net`) | Zona autoritativa en **GoDaddy** |
| MX | `0 smtp.secureserver.net`, `10 mailstore1.secureserver.net` | MX de GoDaddy. **Confirmar** con GoDaddy que son los MX correctos para *Professional Email powered by Titan* (Titan suele usar `mx1/mx2.titan.email`); la recepción hoy funciona según el usuario |
| TXT (SPF) | `v=spf1 include:secureserver.net -all` | Único SPF ✔ · ~4 consultas DNS (secureserver.net → spf-0.secureserver.net → spf.protection.outlook.com) < 10 ✔ · `-all` estricto ✔ |
| TXT | `google-site-verification=…` | Verificación de Google; **no tocar** |
| `_dmarc` | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` | En aplicación (`quarantine`, `pct` por omisión = 100, `sp` hereda). Informes a GoDaddy (no visibles para MAC) |
| `default._bimi` | (no existe) | Pendiente |
| DKIM | Sin respuesta en selectores probados: titan1, titan2, titan, default, secureserver, s1, s2, k1, google, selector1, x, dkim, mail | **No verificado**: obtener `s=`/`d=` del encabezado `DKIM-Signature` de un correo real (Gmail → «Mostrar original») o del panel de Titan/GoDaddy |
| `maccompresores.app` | A `31.220.20.100`, NS Porkbun, TLS Let's Encrypt (vence 2027-01-07), HTTP 200 sin redirecciones en recursos estáticos | Apto para alojar el SVG |

## Riesgos
1. **DKIM desconocido:** con `p=quarantine`, si Titan no firma con `d=maccompresores.com.mx`, DMARC depende solo de SPF alineado; un reenvío rompe SPF → posible cuarentena de cotizaciones/recuperación de contraseña.
2. **Informes DMARC** van a un buzón de GoDaddy: MAC no puede ver qué emisores fallan.
3. **MX** posiblemente heredados de un producto anterior de GoDaddy (verificar).

## Recomendado vs actual
- SPF: correcto, sin cambios.
- DKIM: confirmar/activar firma DKIM de dominio propio en Titan (GoDaddy publica el CNAME/TXT automáticamente si el DNS está en GoDaddy).
- DMARC: mantener `p=quarantine`; añadir un `rua` propio solo si se desea monitoreo (ver propuesta). No endurecer a `reject` sin datos.
