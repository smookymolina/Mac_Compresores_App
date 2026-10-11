# Resultados de pruebas — v1.3.7 (2026-10-11)

- `tsc --noEmit`: OK · ESLint (archivos tocados): OK.
- Vitest (unit + integración, Postgres 16 temporal): **74/74**.
- Build Docker de producción (`runner`): OK; despliegue `docker compose up -d --build app` con migración: OK, contenedor `healthy`, 0 errores en logs.
- Playwright en imagen aislada (Chromium 360 px / WebKit iPhone SE 320 px): sin desbordes en Cotización nueva (incl. paquete Personalizado), Detalle y modal Enviar; modal visible también sin `showModal` (simulación de iOS < 15.4); QR de WhatsApp visible en escritorio.
- SVG: `xmllint` OK; render `rsvg-convert` OK; producción HTTP 200 `image/svg+xml`, `cmp` idéntico.
- DNS: consultas `dig` en `dns-audit.md`.
- Correo real: 1 envío a destinatario autorizado aceptado (`250 mail accepted`) y recibido por el usuario. **Pendiente:** envíos a Gmail/Outlook controlados para leer `Authentication-Results` (SPF/DKIM/DMARC).
