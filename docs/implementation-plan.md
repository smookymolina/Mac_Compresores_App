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

## v1.2.0
- [x] Usuarios por invitación: el admin captura nombre, correo y rol; la persona activa su cuenta y elige su contraseña en `/invitacion` (enlace de un solo uso, 72 h, reenviable; estado «Invitación pendiente»). Correos de acceso con la plantilla de marca (`renderEmail`): restablecer contraseña, aviso «Tu contraseña se cambió» e invitación. Migración `user_invitations`.

## Siguiente
1. Confirmar con dirección los supuestos de comisiones (`architecture.md`) y activar la regla.
2. Revisar ~2,500 filas de la lista con SKU repetido (mismo OEM + no. de parte) y ~330 con `Type` = `#N/A`.
3. Cotización original (`Cotizacion Original.xlsm`) está protegida con contraseña: con acceso, alinear el PDF a su formato (condiciones, datos bancarios, firma).
   - [x] PDF alineado al formato oficial (PDF de referencia, 2026-10-08): ficha Empresa/Cliente/Folio/Fecha, partidas con descuento, «Complementos» del servicio de 8000 h (solo si la cotización lo incluye), totales, distribuidores oficiales (Milwaukee) y términos A–J. Sin firma de cotizador. Datos bancarios: configurables con `BANK_INFO` (v1.1.2).
4. ~~Cobranza y expiración automática de cotizaciones~~ (v1.1.2). Pendiente de decisión: calcular comisiones sobre lo cobrado (`CommissionBasis.COLLECTED`).
   - [x] Paginación (50 por página, `src/lib/pagination.ts`) en clientes, cotizaciones y ventas; ventas con búsqueda por folio/cliente y filtro de estado (2026-10-08).
5. Despliegue: Dockerfile de la app, `SESSION` en HTTPS (cookie `secure` ya activa en producción), respaldos de BD, limitador de login compartido (Redis) si hay varias instancias.

## v1.4.0 — App móvil sin conexión (en desarrollo, NO desplegar hasta pruebas)
Propuesta: `docs/propuesta-offline-sync.md` (5 usuarios, Android + iOS).
- [x] Fase 0: núcleo de dominio puro `src/domain/` (dinero con decimal.js, precios, estados, moneda, complementos, formatos, PDF de cotización sin `fs`/BD). Rutas anteriores re-exportan; pruebas de pureza (`domain-purity`) y paridad Prisma.Decimal ↔ decimal.js (`domain-parity`).
- [x] Fase 1: infraestructura de sincronización — migración `offline_sync` (Device, SyncChange con triggers, SyncCommand, ReservedFolio, `User.mobileAccess`, `Quote.origin`); API `/api/sync/{register,logout,bootstrap,pull,push,folios}` y `/api/app/version`; push idempotente sobre los services; página Sincronización y casilla «App móvil». Pruebas locales: `docs/v1.4.0-pruebas-locales.md`.
  - Pendiente: poda de `SyncChange` (requiere respuesta «cursor viejo → re-bootstrap» en el teléfono); fusión por campo en `customer.save` (fase 4); comando y su registro en transacciones separadas (reenvío tras caída a la mitad puede responder REJECTED en `quote.status`/`sale.convert`).
- [x] Fase 2: app móvil base «MAC Campo» (`mobile/`, Capacitor 8): login con cuenta web, PIN/huella, SQLite cifrada, descarga inicial y pull, catálogo y clientes sin conexión; proyecto Android y workflow `mobile-android.yml` (APK); poda diaria de `SyncChange` + 410 RESYNC. Instrucciones: `docs/v1.4.0-instrucciones.md`.
- [x] Fase 3: cotizaciones sin conexión — editor, PDF en el teléfono (mismo mapeo que la web, `src/domain/quote-pdf-data.ts`), compartir y correo en cola, folios apartados, ventana de precio (`sync.priceGraceDays`, 3 días) y conflictos de precio resueltos en Sincronización; `/api/sync/config` y `/api/sync/commands`.
- [x] Fase 4: clientes con fusión por campo, contactos/direcciones, ventas pendientes con conflicto de existencias (convertir desde otro almacén / reintentar / rechazar), pagos (rebasar saldo = rechazado), movimientos de almacén, bandeja de conflictos; fecha de captura futura acotada; dispositivo revocado no puede resolver.
- [x] Fase 5: entrega Android — «Versiones de la app» en Sincronización (APK en `releases/`, `APP_DOWNLOAD_SECRET`), página `/app` con «Descargar APK», aviso de actualización y actualización obligatoria (envía pendientes primero), aviso de pendientes > 24 h, dispositivos desactualizados / sin sincronizar. Guías: `docs/mac-campo-guia-usuario.md`, `docs/mac-campo-publicar-version.md`, `docs/piloto-v1.4.0.md`. Pendiente: ejecutar el piloto.
- [x] Fase 5 bis: iOS — proyecto `mobile/ios` (SPM), workflow `mobile-ios.yml` (macOS, firma con secrets), distribución Ad Hoc desde el hosting (itms-services) y TestFlight opcional. Pendiente: primera compilación firmada con la cuenta Apple.
