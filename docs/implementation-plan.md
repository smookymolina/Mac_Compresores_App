# Plan de implementación

## Fase 1 — MVP (completada 2026-10-07)
- [x] Base: Next.js, Prisma/PostgreSQL (Docker), tema de marca, layout con navegación por permisos
- [x] Autenticación por sesión, roles y permisos, gestión de usuarios
- [x] Productos/precios, historial de precios, importación CSV (probada con la lista real: 33,884 productos)
- [x] Clientes con contactos, direcciones e historial
- [x] Cotizaciones con instantánea de precios, estados, PDF
- [x] Ventas desde cotización aceptada (transaccional), cancelación compensatoria
- [x] Inventario: almacenes, entradas/salidas/ajustes, reversas, stock mínimo
- [x] Comisiones versionadas (tabla verde/rojo), periodos, metas, cálculo, aprobación y pago
- [x] Dashboard y auditoría
- [x] Pruebas: unitarias, integración (concurrencia, autorización, transiciones), E2E

## v1.1.2 (2026-10-10)
- [x] Seguridad: dependencias sin vulnerabilidades en producción (`overrides` de postcss y deepmerge-ts), CI en GitHub Actions, límite de intentos en BD (`RateLimit`).
- [x] Operación: respaldo diario (`backup`) y trabajo diario (`scheduler` → `/api/cron/daily` con `CRON_SECRET`).
- [x] Cotización por correo con PDF adjunto (Reply-To del vendedor); datos bancarios en el PDF (`BANK_INFO`).
- [x] Vencimiento automático de cotizaciones, recordatorio 3 días antes, aviso diario de stock bajo mínimo y de cobro vencido.
- [x] Cobranza: pagos inmutables (anulación con motivo), saldo por venta, página de cuentas por cobrar.
- [x] Reportes CSV (ventas, cotizaciones, pagos, comisiones, existencias, catálogo).
- [x] Dashboard: venta neta 12 meses, conversión 90 días, metas del periodo y por cobrar.
- [x] Búsqueda global (Ctrl+K), avisos en la app, PWA instalable.
- [x] Importación: resumen por tipo de error y descarga de errores en CSV para corregir la lista.

## Siguiente
1. Confirmar con dirección los supuestos de comisiones (`architecture.md`) y activar la regla.
2. Revisar ~2,500 filas de la lista con SKU repetido (mismo OEM + no. de parte) y ~330 con `Type` = `#N/A`.
3. Cotización original (`Cotizacion Original.xlsm`) está protegida con contraseña: con acceso, alinear el PDF a su formato (condiciones, datos bancarios, firma).
   - [x] PDF alineado al formato oficial (PDF de referencia, 2026-10-08): ficha Empresa/Cliente/Folio/Fecha, partidas con descuento, «Complementos» del servicio de 8000 h (solo si la cotización lo incluye), totales, distribuidores oficiales (Milwaukee) y términos A–J. Sin firma de cotizador. Datos bancarios: configurables con `BANK_INFO` (v1.1.2).
4. ~~Cobranza y expiración automática de cotizaciones~~ (v1.1.2). Pendiente de decisión: calcular comisiones sobre lo cobrado (`CommissionBasis.COLLECTED`).
   - [x] Paginación (50 por página, `src/lib/pagination.ts`) en clientes, cotizaciones y ventas; ventas con búsqueda por folio/cliente y filtro de estado (2026-10-08).
5. Despliegue: Dockerfile de la app, `SESSION` en HTTPS (cookie `secure` ya activa en producción), respaldos de BD, limitador de login compartido (Redis) si hay varias instancias.
