# Informe de validación — 2026-10-11

| Punto | Estado |
|---|---|
| SMTP Titan (465 TLS, auth) preservado; `verify()` + envío real aceptado (250) | VERIFICADO |
| Remitente `MAC Compresores <ventas@maccompresores.com.mx>` | VERIFICADO (env del contenedor) |
| Reply-To al buzón de la empresa (`companyReplyTo`) | VERIFICADO en pruebas e interfaz; desplegado |
| Credenciales fuera del repo y del frontend (sin `NEXT_PUBLIC_`, escaneo del diff limpio) | VERIFICADO |
| SPF único, `-all`, ~4 consultas | VERIFICADO |
| DMARC `p=quarantine` (cumple requisito BIMI) | VERIFICADO |
| DKIM (selector/alineación) | NO VERIFICADO — requiere encabezado real o panel Titan |
| MX correctos para Titan | NO VERIFICADO — confirmar con GoDaddy |
| Logotipo oficial obtenido de Drive | VERIFICADO (PNG 1254×1254, sin vectorial oficial) |
| SVG Tiny PS (root `version=1.2 baseProfile=tiny-ps`, `<title>`, sin script/image/href/style/x/y, cuadrado, fondo sólido, 3.9 KB, XML válido, render 400/48 px) | IMPLEMENTADO LOCALMENTE + verificado con xmllint/rsvg; validador oficial BIMI: NO VERIFICADO |
| Alojamiento HTTPS `https://maccompresores.app/email-branding/mac-compresores-bimi.svg` (200, `image/svg+xml`, sin redirección, sin sesión, contenido idéntico) | VERIFICADO en producción |
| Registro `default._bimi` | PREPARADO, PENDIENTE DE AUTORIZACIÓN (y de DKIM) |
| Certificado VMC/CMC | BLOQUEADO POR REQUISITO EXTERNO (compra/marca/uso ≥12 meses) |
| Logotipo mostrado en Gmail/Apple/Yahoo | NO VERIFICADO (sin BIMI publicado) |
