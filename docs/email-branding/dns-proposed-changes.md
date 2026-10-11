# Cambios DNS propuestos — NO aplicados (requieren autorización)

## 1. DKIM (prioridad alta) — PENDIENTE DE DATOS
Activar/confirmar en GoDaddy › Correo profesional › Configuración DNS/DKIM. No generar claves propias. Verificar después: `dig +short TXT <selector>._domainkey.maccompresores.com.mx` y `dkim=pass header.d=maccompresores.com.mx` en un encabezado real.

## 2. BIMI — PREPARADO, PENDIENTE (DKIM verificado + despliegue v1.3.7 + certificado)
| Campo | Valor |
|---|---|
| Nombre | `default._bimi.maccompresores.com.mx` |
| Tipo | TXT |
| Valor (fase sin certificado) | `v=BIMI1; l=https://maccompresores.app/email-branding/mac-compresores-bimi.svg; a=;` |
| Valor (con VMC/CMC) | `v=BIMI1; l=https://maccompresores.app/email-branding/mac-compresores-bimi.svg; a=<URL HTTPS del .pem emitido por la CA>;` |
| TTL | 3600 (o el predeterminado de GoDaddy) |

Prerrequisitos: DMARC `p=quarantine|reject` (ya cumple), SPF y DKIM alineados con `pass`, SVG publicado y accesible (`curl -sI` 200 `image/svg+xml`).
Aplicación: GoDaddy › DNS › Agregar TXT `default._bimi`. Reversión: eliminar ese TXT (no afecta la entrega).
Verificación: `dig +short TXT default._bimi.maccompresores.com.mx`; validador oficial https://bimigroup.org/bimi-generator/.

## 3. DMARC (opcional) — informes propios
Solo si se quiere visibilidad: añadir un destino propio a `rua` **conservando** el de GoDaddy, p. ej. `rua=mailto:dmarc_rua@onsecureserver.net,mailto:dmarc@maccompresores.com.mx`. No cambiar `p`.
