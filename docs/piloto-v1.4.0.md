# Piloto v1.4.0 — MAC Campo

Objetivo: comprobar en campo, con usuarios reales, que la app funciona sin internet y sincroniza sin perder ni duplicar datos,
antes de usarla en producción con todos.

## 1. Calendario

| Semana | Usuarios | Enfoque |
|---|---|---|
| 1 | 2 (1 vendedor + 1 de gerencia o almacén) | Instalación, cotizaciones sin internet, sincronización diaria. |
| 2 | Los 5 | Todo el flujo: clientes, ventas pendientes, cobros, almacén, actualización de versión. |

Al final de cada semana: reunión corta (30 min) para revisar métricas y retroalimentación.

## 2. Preparación (antes del día 1)

1. **Respaldo** de la base de producción (`docs/v1.4.0-instrucciones.md` §2). Cópialo fuera del servidor.
2. **Despliegue** de v1.4.0 (`docs/v1.4.0-instrucciones.md` §6), con:
   - `APP_DOWNLOAD_SECRET` en `.env` (`openssl rand -hex 32`);
   - volumen `releases/` montado.
3. **APK firmado** publicado en **Sincronización → «Versiones de la app»** (`docs/mac-campo-publicar-version.md`).
4. **Usuarios → «App móvil»**: actívala solo a los 2 usuarios de la semana 1 (a los 5 en la semana 2).
5. Entrega a cada usuario `docs/mac-campo-guia-usuario.md` y acompaña la primera instalación (en Wi-Fi).
6. Prueba tú mismo una cotización sin internet y su sincronización antes de entregar.

## 3. Revisión diaria (10 min, admin)

En la web → **Sincronización**:
- [ ] **Incidencias**: resuelve conflictos de precio («Aplicar precio actual / Respetar precio del teléfono / Rechazar») y de existencias («Convertir desde otro almacén» / «Reintentar» / «Rechazar»).
- [ ] **Dispositivos «Sin sincronizar hace N h»**: más de 24 h → llama al usuario.
- [ ] **Dispositivos «Desactualizada»**: pide que actualicen.
- [ ] Compara 1–2 cotizaciones del día: folio y totales iguales en teléfono, PDF y web.
- [ ] Anota en la tabla de métricas.

## 4. Métricas

| Métrica | Cómo se mide | Meta |
|---|---|---|
| Cotizaciones capturadas sin internet | Cotizaciones con origen móvil en la web | ≥ 10 en el piloto |
| Conflictos (precio / existencia / RFC) | Incidencias en Sincronización | Todas resueltas en ≤ 1 día hábil |
| Rechazos | Rechazados en Sincronización y en «Pendientes / incidencias» | Cada uno con causa entendida; 0 por error de la app |
| Tiempo hasta sincronizar | Entre la captura y su llegada al servidor | Mayoría < 24 h; ninguno > 72 h |
| Datos perdidos o duplicados | Revisión diaria + reportes | **0** |
| Dispositivos desactualizados | «Desactualizada» en Sincronización | 0 al día siguiente de publicar |

## 5. Formulario de retroalimentación

Cada usuario lo llena al final de cada semana (papel, WhatsApp o correo).

| Pregunta | Respuesta (1 = mal, 5 = excelente) | Comentario |
|---|---|---|
| La instalación fue sencilla | | |
| Encuentro productos rápido en el Catálogo | | |
| Cotizar sin internet funciona bien | | |
| El PDF se ve bien y se comparte fácil | | |
| Entiendo la barra de estado y «Sincronizar ahora» | | |
| Entiendo las incidencias y qué hacer | | |
| Clientes / ventas / pagos / inventario funcionan | | |
| La app es rápida en mi teléfono | | |
| ¿Algo se perdió, se duplicó o salió con otro total? | Sí / No | |
| ¿Qué falta o qué cambiarías? | — | |

Datos del usuario: nombre, modelo de teléfono, versión de Android, versión de la app (Más → Aplicación).

## 6. Criterios para pasar a producción

Todos deben cumplirse al final de la semana 2:
- [ ] 0 datos perdidos o duplicados.
- [ ] Totales y folios iguales en teléfono, PDF y web en todas las revisiones.
- [ ] Ningún rechazo causado por un error de la app sin corregir.
- [ ] Los 5 usuarios instalaron, sincronizaron y actualizaron al menos una vez.
- [ ] Calificación promedio ≥ 4 en el formulario.
- [ ] La web siguió funcionando igual (cotizaciones, ventas, cobranza, inventario, comisiones).

## 7. Criterios para detener el piloto

Detén de inmediato (ver plan de regreso) si ocurre cualquiera:
- Se pierden o duplican cotizaciones, ventas, pagos o movimientos.
- Totales, impuestos o folios distintos entre teléfono y web.
- Inventario descontado de más o de menos.
- Un usuario ve clientes o costos que no le corresponden.
- La web se vuelve lenta o falla por la sincronización.

## 8. Plan de regreso

1. **Usuarios** → desactiva **«App móvil»** a todos. La app deja de sincronizar (lo pendiente queda en el teléfono; no se pierde mientras no se desinstale).
2. **La web sigue igual**: los usuarios capturan en la web como antes.
3. Revisa las incidencias y decide con cada usuario qué capturar a mano en la web.
4. Solo si la web falla: vuelve a desplegar **v1.3.18** (la migración solo agrega estructura, la versión anterior funciona sobre ella). Restaurar el respaldo es el último recurso.
5. Documenta la causa y corrígela antes de reiniciar el piloto.
