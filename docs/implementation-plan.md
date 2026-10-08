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

## Siguiente
1. Confirmar con dirección los supuestos de comisiones (`architecture.md`) y activar la regla.
2. Revisar ~2,500 filas de la lista con SKU repetido (mismo OEM + no. de parte) y ~330 con `Type` = `#N/A`.
3. Cotización original (`Cotizacion Original.xlsm`) está protegida con contraseña: con acceso, alinear el PDF a su formato (condiciones, datos bancarios, firma).
4. Cobranza (habilita comisiones sobre cobro) y expiración automática de cotizaciones.
   - [x] Paginación (50 por página, `src/lib/pagination.ts`) en clientes, cotizaciones y ventas; ventas con búsqueda por folio/cliente y filtro de estado (2026-10-08).
5. Despliegue: Dockerfile de la app, `SESSION` en HTTPS (cookie `secure` ya activa en producción), respaldos de BD, limitador de login compartido (Redis) si hay varias instancias.
