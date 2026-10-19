# Propuesta: app Android sin conexión con sincronización («MAC Campo»)

> Estado: **propuesta para aprobación**. No modifica la operación actual: la app web y el hosting siguen igual.
> Basada en el código real del repo (v1.3.18): `prisma/schema.prisma`, `modules/quotes/{pricing,service,status,pdf}.ts`,
> `modules/sales/service.ts`, `modules/inventory/service.ts`, `lib/money.ts`, `lib/auth/permissions.ts`.

## 1. Objetivo

> **Alcance de uso:** app **privada** para unos cuantos usuarios de MAC (no se publica en tiendas). Tú les envías el APK, ellos
> lo instalan y entran **con su misma cuenta de la web** (correo y contraseña). Todos los teléfonos y la web comparten **una sola
> base de datos central** en el hosting; cada teléfono guarda una copia local que se sincroniza con ella.

Que vendedores y gerencia puedan **cotizar, registrar clientes, cobrar y levantar ventas sin internet** desde un teléfono o
tableta Android. Al recuperar señal, todo se **sincroniza solo** con el servidor en el hosting actual, sin capturar nada dos veces.

Lo que no cambia:

- El servidor (Next.js + PostgreSQL en el hosting) sigue siendo **la fuente de verdad**. La app del teléfono es una copia local
  que propone cambios. El servidor los valida con las mismas reglas de hoy y los acepta o los marca como conflicto.
- La app web sigue funcionando igual para oficina, almacén y administración.
- Las reglas de negocio se mantienen: precios del catálogo, descuento ≤ 15 % sin permiso, inventario sin negativos,
  movimientos inmutables, auditoría.

## 2. Qué se podrá hacer sin conexión

| Módulo | Sin conexión | Cómo se resuelve al sincronizar |
|---|---|---|
| **Catálogo** (≈34 mil productos, precios, TC USD) | Consultar y buscar (SKU, OEM, no. de parte, descripción) | Descarga incremental de los cambios |
| **Clientes** propios y sin asignar | Consultar, **crear**, editar, agregar contactos y direcciones | Se aplica. Si dos personas editan el mismo campo, gana la última edición y queda auditado. RFC duplicado → conflicto |
| **Cotizaciones** | **Crear, editar borradores, generar PDF, compartir** (WhatsApp/correo del teléfono), cambiar estado (enviada, aceptada, rechazada) | El servidor recalcula y valida. Ver §5.3 (precios) y §5.4 (folios) |
| **Envío por correo desde el sistema** | Se pone en cola | Se envía al conectar (usa el `email.ts` actual) |
| **Ventas** (desde cotización aceptada) | Registrar como **«venta pendiente de confirmar»** | El servidor descuenta inventario con la guarda actual. Sin existencia suficiente → conflicto para gerencia |
| **Cobranza** | Registrar pagos (efectivo, transferencia, etc.) | Los pagos son inmutables, así que se agregan sin conflicto. Un pago mayor al saldo → conflicto |
| **Inventario** | Consultar existencias «al dd/mm hh:mm». Almacén: registrar entradas y salidas | Entradas se aplican siempre. Salidas usan el UPDATE condicionado actual |
| **Dashboard** | Resumen de los datos propios en el teléfono | Se recalcula en servidor |
| **Comisiones, usuarios, auditoría, reportes, importación CSV, portal de socios, tipo de cambio, aprobaciones** | **Solo con conexión** | Son tareas administrativas o de cálculo global; no conviene hacerlas fuera de línea |

## 3. Arquitectura

```
┌──────────────────────── Teléfono Android (APK) ───────────────────────┐
│  UI React + Tailwind (misma identidad visual)                         │
│  Reglas compartidas: src/domain (money, pricing, status, pdf)         │
│  SQLite cifrada (SQLCipher)                                           │
│    ├─ copia local: productos, clientes, cotizaciones, ventas, saldos  │
│    └─ outbox: cola de comandos pendientes (idempotentes)              │
│  Motor de sincronización (al abrir, al recuperar red, cada 5 min)     │
└───────────────┬────────────────────────────────────▲──────────────────┘
                │ POST /api/sync/push (comandos)      │ GET /api/sync/pull?cursor=…
                ▼                                     │ (cambios desde el cursor)
┌──────────────────────── Hosting actual (sin cambios de infraestructura) ┐
│  Next.js: módulo nuevo src/modules/sync → llama a los services actuales │
│  (createQuote, convertQuoteToSale, registerPayment, saveCustomer…)       │
│  PostgreSQL: tablas nuevas SyncChange, SyncCommand, Device,              │
│  FolioReservation, SyncConflict                                          │
│  App web: sin cambios para el usuario + bandeja «Sincronización»         │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Tecnología recomendada

| Pieza | Elección | Por qué |
|---|---|---|
| Contenedor nativo | **Capacitor** (Ionic), versión estable vigente | Genera el APK a partir de React y TypeScript, el mismo lenguaje del proyecto. Da acceso a SQLite, red, compartir archivos y almacenamiento seguro |
| UI móvil | React + Vite + Tailwind 4 en `mobile/` dentro del mismo repo | Reutiliza tokens de marca y componentes de `src/components/ui`. Next.js con Server Components no puede correr sin servidor, por eso la app móvil es una SPA aparte |
| Base local | `@capacitor-community/sqlite` con **cifrado SQLCipher** | Aguanta 34 mil productos con búsqueda rápida (FTS5). IndexedDB se queda corto para ese volumen y el tipo de búsqueda |
| Dinero | `decimal.js` (la librería sobre la que está construido `Prisma.Decimal`) | Mismo redondeo half-up en teléfono y servidor. Nunca `number` |
| PDF | `pdf-lib` (el que ya se usa) | Corre igual en el teléfono. Solo hay que pasarle las imágenes como bytes en vez de leerlas con `fs` |
| Credenciales | Android Keystore (`@capacitor/preferences` + plugin de almacenamiento seguro) + PIN/huella | El token del dispositivo nunca queda en texto plano |

**Alternativa descartada:** PWA con service worker sobre la app actual. Las páginas son Server Components y las reglas viven en
server actions. Hacerlas funcionar sin servidor implicaría reescribir la web, y IndexedDB no da búsqueda de texto completo sobre el catálogo.

## 4. Cambios en el código actual (servidor)

### 4.1 Extraer las reglas a un núcleo compartido `src/domain/`

Se mueven, **sin cambiar comportamiento**, las funciones puras que hoy dependen de `@prisma/client` solo por el tipo `Decimal`:

- `lib/money.ts` → `domain/money.ts` (con `decimal.js`; `Prisma.Decimal` acepta esas instancias)
- `modules/quotes/pricing.ts` (`buildItemSnapshots`, `catalogPriceMxn`) → `domain/pricing.ts`
- `modules/quotes/status.ts`, `currency.ts`, `complements/match.ts` → `domain/`
- `modules/quotes/pdf.ts`: separar el **dibujo** del PDF (puro, recibe datos e imágenes en bytes) de la **carga** (BD + `fs`)
- `MAX_DISCOUNT_WITHOUT_OVERRIDE` y el mapa `ROLE_PERMISSIONS` quedan importables desde el teléfono

Los archivos originales re-exportan desde `domain/` para no romper imports. Las pruebas actuales de `vitest` deben pasar
idénticas; se agrega una prueba de paridad que corre el mismo set de partidas en el teléfono y en el servidor y exige
totales idénticos al centavo.

### 4.2 Tablas nuevas (una migración: `npm run db:migrate -- --name offline_sync`)

| Modelo | Para qué |
|---|---|
| `Device` | Teléfono registrado: usuario, nombre, hash del token, último sync, versión de app, `revokedAt` |
| `SyncChange` | Bitácora de cambios con secuencia `BIGSERIAL` (entidad, id, operación, `seq`). La llenan **triggers de PostgreSQL** en Product, Customer, CustomerContact, CustomerAddress, Quote, QuoteItem, Sale, Payment, StockBalance, ExchangeRate y ComplementPackage. Así ningún cambio se escapa aunque venga de la web, del CSV o del cron |
| `SyncCommand` | Cada comando recibido de un teléfono, con su `id` (UUID generado en el teléfono) como clave única. Si el teléfono reintenta, se devuelve el mismo resultado sin aplicarlo dos veces (**idempotencia**) |
| `SyncConflict` | Comandos que el servidor no pudo aplicar tal cual. Guarda el motivo, la propuesta del teléfono y el estado actual. Se resuelven desde la web |
| `FolioReservation` | Bloques de folios de cotización reservados por dispositivo (ver §5.4) |

Campos nuevos:
- `Quote`: `origin` (`WEB`/`MOBILE`), `deviceId`, `offlineCreatedAt`, `catalogSeq` (versión del catálogo que tenía el teléfono).
- `Sale`: estado nuevo `PENDING_SYNC` no es necesario. La venta pendiente vive solo en el teléfono hasta que el servidor
  la confirma con `convertQuoteToSale`, así que el modelo de ventas no cambia.

Los IDs ya son UUID en todo el esquema, lo que permite crear registros en el teléfono **con su ID definitivo** y sin choques.

### 4.3 Módulo `src/modules/sync/`

- `protocol.ts`: esquemas Zod de cada comando (`customer.save`, `quote.create`, `quote.update`, `quote.status`,
  `quote.email`, `sale.convert`, `payment.register`, `inventory.movement`). Los decimales viajan como string, igual que hoy.
- `service.ts`:
  - **push**: aplica los comandos en orden, cada uno en su `db.$transaction`, **llamando a los services existentes**
    (`createQuote`, `updateQuote`, `changeQuoteStatus`, `convertQuoteToSale`, `registerPayment`, `saveCustomer`,
    `registerMovement`). No se duplica lógica: autorización por objeto (`customerScope`), guardas de estado y `audit()`
    funcionan igual. El registro de auditoría lleva además `deviceId` y la hora real de captura en el teléfono.
  - **pull**: devuelve los `SyncChange` con `seq > cursor`, **filtrados por scope del usuario**. VENTAS solo recibe sus clientes y
    sus cotizaciones/ventas. Si un cliente se reasigna a otro vendedor, se manda una «baja» para que desaparezca del teléfono.
  - **bootstrap**: primera descarga completa paginada (el catálogo comprimido pesa ~3–5 MB).
- Route handlers en `src/app/api/sync/{register,push,pull,bootstrap}/route.ts`. Autenticación con `Authorization: Bearer <token de dispositivo>`
  (la cookie de sesión de 12 h no sirve para un teléfono que pasa días sin red). Límite de intentos con el `RateLimit` existente.
- Cabecera `X-Sync-Protocol`: si el teléfono trae una versión vieja, el servidor responde «actualiza la app» en vez de aplicar datos dudosos.

### 4.4 Pantallas nuevas en la web

- **Acceso a la app móvil por usuario** (en **Usuarios**, solo ADMIN): casilla «Puede usar la app móvil». Si no está marcada,
  aunque alguien tenga el APK y una cuenta válida, el servidor no le registra el dispositivo. Opcional: el primer inicio de
  sesión desde un teléfono nuevo queda **«pendiente de aprobar»** hasta que el ADMIN lo autoriza (útil con pocos usuarios).

- **Sincronización** (`/sincronizacion`, ADMIN y GERENCIA): dispositivos activos, último sync, pendientes y **bandeja de conflictos**
  con acciones *aceptar con precio actual*, *aceptar precio capturado* (requiere `quotes.override_price`), *rechazar y avisar al vendedor*.
- En **Usuarios**: botón «Revocar dispositivo». Si roban o pierden un teléfono, en el siguiente contacto se borra su base local y ya no puede sincronizar.
- Cotizaciones y ventas muestran la insignia «Capturada sin conexión» con la hora real de captura.

## 5. Reglas de sincronización (lo delicado)

### 5.1 Flujo general

1. Cada acción en el teléfono se guarda **localmente al instante** y se agrega al **outbox** como comando con UUID.
2. Al haber red: **push** de comandos en orden → el servidor responde por comando `aplicado` / `conflicto` / `rechazado`.
3. Después **pull** de cambios desde el último cursor → el teléfono actualiza su copia (precios nuevos, folios definitivos, estados).
4. Si la red se corta a la mitad no pasa nada: los comandos ya aplicados no se repiten (idempotencia) y el resto se reintenta.

### 5.2 Conflictos por tipo de dato

| Dato | Regla |
|---|---|
| Movimientos de inventario, pagos, auditoría | **Solo se agregan**, nunca se editan (como hoy). No generan conflictos de edición |
| Clientes | Fusión por campo: gana el cambio más reciente y queda auditado. RFC repetido (`@unique`) → conflicto |
| Cotización en borrador | Bloqueo optimista con `updatedAt` (ya existe en `updateQuote`). Si cambió en la web mientras el teléfono estaba sin red → conflicto con ambas versiones a la vista |
| Cambios de estado | Se validan con `QUOTE_TRANSITIONS`. Una transición imposible (p. ej. ya la canceló gerencia) → rechazada y notificada |
| Venta | `convertQuoteToSale` con su guarda actual (`quoteId` único + salida condicionada). Dos vendedores vendiendo la última pieza sin red: **el primero que sincroniza gana**. El segundo queda en conflicto para gerencia (surtir de otro almacén, esperar compra o cancelar) |

### 5.3 Precios capturados sin conexión

El teléfono calcula con su copia del catálogo usando **la misma función** `buildItemSnapshots`, así que el cliente ve el precio real.
Al sincronizar, el servidor **recalcula siempre** (la regla «precios se calculan en servidor» se mantiene):

- **Precio igual al actual** → se aplica.
- **Precio distinto** (cambió la lista mientras estaba sin red):
  - si el catálogo del teléfono tenía **≤ N días** (propuesta: 3 días, configurable) y el precio capturado aparece en
    `PriceHistory` para ese producto → **se respeta el precio que vio el cliente** y queda auditado como «precio de catálogo anterior»;
  - si no → **conflicto** para que gerencia decida.
- Descuento > 15 % sin permiso: el teléfono ni lo deja capturar, y el servidor lo vuelve a rechazar.
- **Costos**: VENTAS **no** recibe costos en el teléfono (hoy la web los oculta sin `products.write`). El costo de la partida
  (`unitCost`) lo pone el servidor al sincronizar.
- Tipo de cambio USD: el teléfono usa el último descargado y lo muestra en la cotización. Si al sincronizar ya hay uno más nuevo, aplica la misma regla de N días.
- Si el teléfono lleva más de N días sin sincronizar, muestra un aviso fijo: «Precios al dd/mm. Conéctate para actualizar».

### 5.4 Folios de cotización

Hoy `Quote.folio` es autoincremental en PostgreSQL y el teléfono no puede pedirlo sin red. Propuesta:

- Cada teléfono **reserva un bloque de folios** (p. ej. 25) mientras tiene red, tomados de la misma secuencia. Así el folio
  `C-1234` que aparece en el PDF que se mandó al cliente **es el definitivo** y no cambia nunca.
- Cuando quedan menos de 5 folios, el teléfono pide otro bloque en el siguiente sync.
- Si se agotan sin red, usa un folio provisional `P-<iniciales>-<n>` con la leyenda «Folio provisional» en el PDF. El folio definitivo se asigna al sincronizar.
- Efecto: puede haber huecos en la numeración (folios reservados que no se usaron). Las cotizaciones no son documentos fiscales,
  así que es aceptable, pero **el cliente debe confirmarlo**.

### 5.5 Sesión y seguridad sin conexión

- **Alta del dispositivo**: con red, el usuario entra con su correo y contraseña de siempre. El servidor emite un **token de dispositivo**
  (guardado en Keystore; en BD solo su SHA-256, igual que las sesiones actuales). Después se desbloquea con **PIN o huella**.
- **Permisos**: se copian al teléfono para mostrar u ocultar funciones. El servidor los **vuelve a validar** en cada comando con los permisos vigentes.
- **Tiempo máximo sin conexión** (propuesta: 7 días): después la app sigue dejando consultar pero bloquea capturas hasta sincronizar.
- **Base local cifrada** con SQLCipher; la llave vive en el Keystore.
- **Usuario desactivado o dispositivo revocado** → en el siguiente contacto se borran los datos locales.
- Al teléfono solo baja lo que el usuario puede ver por su rol (scope); nada de otros vendedores.

## 6. Distribución privada del APK (sin Google Play)

### 6.1 Cómo les llega la app
1. Se compila un **APK firmado** con la llave de MAC (ver §6.3).
2. El APK se **publica en el mismo hosting**, en una ruta protegida: `https://<dominio>/app` (solo con sesión iniciada y el permiso de
   app móvil), o se manda directo por WhatsApp/correo/Drive. La ruta en el hosting es mejor: siempre está la última versión y no
   circulan APK viejos.
3. El usuario lo abre en su Android, acepta **«Permitir instalar apps de esta fuente»** (una sola vez; se incluye una guía con capturas).
4. Abre la app, escribe su **correo y contraseña de siempre**, crea su **PIN** (o activa huella) y la app descarga sus datos
   (catálogo, sus clientes y cotizaciones). Desde ese momento ya funciona sin internet.

Google Play Protect puede mostrar un aviso «App no reconocida» por no venir de la tienda; es normal en apps privadas y se indica en la guía
cómo continuar. Si a futuro prefieren evitarlo, se puede subir a Play en modo **prueba cerrada** (solo los correos invitados la ven) sin hacerla pública.

### 6.2 Actualizaciones sin tienda
- El servidor expone `GET /api/app/version` con la versión vigente, la mínima aceptada y notas del cambio.
- Al sincronizar, la app compara: si hay versión nueva muestra **«Actualizar»**, descarga el APK desde el hosting y abre el
  instalador de Android (permiso `REQUEST_INSTALL_PACKAGES`). La instalación encima **conserva la base local y los pendientes**.
- Si la versión del teléfono es menor a la mínima (cambio de protocolo), la app **primero sube sus pendientes** y luego pide actualizar
  antes de seguir capturando. Nunca se pierde lo capturado.
- Cambios que solo afectan reglas del servidor (precios, permisos, validaciones) **no requieren** reinstalar nada.

### 6.2 bis iPhone / iPad (iOS)
El mismo código Capacitor genera la app de iOS, pero Apple **no permite instalar archivos sueltos** como el APK. Para 5 usuarios:
- **Requisito**: cuenta Apple Developer (USD 99/año) y compilar en macOS (Mac propia o runner macOS de GitHub Actions).
- **Opción recomendada — Ad Hoc**: se registran los UDID de los iPhone de los usuarios (hasta 100 por año) y se instala desde un
  enlace del propio hosting (`itms-services`). No caduca mientras el certificado esté vigente (1 año; se renueva).
- **Alternativa — TestFlight**: los usuarios instalan la app TestFlight y aceptan la invitación por correo. Más simple, pero cada build caduca a los 90 días.
- La auto-actualización de §6.2 en iOS solo **avisa** y abre el enlace de descarga (iOS no deja instalar desde la app).

### 6.3 Llave de firma (importante)
- Android solo permite actualizar una app encima de otra si **ambas están firmadas con la misma llave**. Si la llave se pierde,
  cada usuario tendría que desinstalar (y perder lo no sincronizado) para instalar la nueva.
- La llave (`.jks`) y sus contraseñas se guardan **fuera del repositorio** (regla del proyecto: nada de secretos en el repo), con
  copia en dos lugares seguros (p. ej. gestor de contraseñas de MAC + respaldo cifrado). El build firmado se hace en GitHub Actions
  leyendo la llave desde *secrets*, o localmente.

## 7. Experiencia de uso en el teléfono

- Barra de estado siempre visible: 🟢 *En línea* · 🟠 *Sin conexión — 4 pendientes* · 🔄 *Sincronizando…* · 🔴 *2 conflictos*.
- Cada registro pendiente muestra «Pendiente de sincronizar». Un conflicto explica el motivo en una frase («El precio de
  ABC-123 cambió de $1,200 a $1,350; gerencia lo revisará»).
- Existencias con fecha: «12 pzas · al 18/10 14:05».
- Compartir PDF desde el teléfono (WhatsApp, correo, Drive) aunque no haya red: se manda en cuanto el teléfono tiene datos o Wi-Fi.
- Sincronización automática al abrir la app, al recuperar red y cada 5 minutos con la app abierta; botón «Sincronizar ahora».

## 8. Plan de trabajo

| Fase | Entregable | Duración estimada* |
|---|---|---|
| 0. Núcleo compartido | `src/domain/` extraído, pruebas de paridad, PDF sin `fs` | 1 semana |
| 1. Infraestructura de sync | Migración, triggers `SyncChange`, `/api/sync/*`, dispositivos, idempotencia, pruebas de integración | 2 semanas |
| 2. App móvil base | Proyecto Capacitor, login + PIN, bootstrap, catálogo y clientes **solo lectura** offline, APK de prueba | 2 semanas |
| 3. Cotizaciones offline | Crear y editar, PDF, compartir, folios por bloque, cola de correo, reglas de precio | 2–3 semanas |
| 4. Clientes, cobranza y ventas | Alta y edición de clientes, pagos, ventas pendientes, inventario de almacén, bandeja de conflictos en la web | 2–3 semanas |
| 5. Piloto y entrega | APK firmado, descarga desde el hosting, auto-actualización, guía de instalación; 2–3 usuarios reales 2 semanas y ajustes | 2 semanas |
| 5 bis. iOS | Build iOS, certificados, distribución Ad Hoc/TestFlight, pruebas en iPhone | +1 semana |
| **Total** | | **≈ 11–13 semanas** con un desarrollador (sin publicación en tienda) |

\* Estimación de referencia. Se puede entregar por fases: al terminar la fase 3 los vendedores ya cotizan sin internet.

## 9. Pruebas

- **Unitarias** (vitest): paridad teléfono/servidor de precios, IVA, descuentos y conversión USD al centavo; reglas de transición.
- **Integración** (BD real, como las de concurrencia actuales): reintento del mismo comando = un solo efecto; dos dispositivos
  vendiendo la última pieza; edición simultánea web/teléfono; cliente reasignado; usuario desactivado; precio cambiado dentro y fuera de la ventana.
- **E2E**: Playwright para la bandeja de conflictos en la web; flujo completo en emulador Android con el modo avión activado y desactivado.
- Antes de cada entrega: `npm run lint && npm run typecheck && npm test && npm run build` (servidor) y build firmado del APK.

## 10. Costos y operación

- **Hosting**: el mismo. Solo se suman algunas tablas y un poco de tráfico. El catálogo completo se descarga una vez (~3–5 MB) y después solo los cambios.
- **Sin tienda (Android)**: no hay cuenta de Google Play ni costo de publicación; **iOS**: cuenta Apple Developer USD 99/año (§6.2 bis); el APK se descarga del propio hosting (§6). Para pocos usuarios la carga extra del servidor es mínima.
- **Respaldos**: los actuales cubren todo. El teléfono no es respaldo: lo que no se ha sincronizado solo existe ahí, y la app avisa si hay pendientes de más de 24 h.
- **Actualizaciones**: el servidor acepta las dos últimas versiones del protocolo; una app más vieja recibe «actualiza».

## 11. Decisiones que necesitamos del cliente

1. **Ventana de precio** (§5.3): ¿cuántos días se respeta un precio de catálogo anterior? Propuesta: 3.
2. **Folios** (§5.4): ¿aceptan huecos en la numeración de cotizaciones a cambio de folios definitivos sin red?
3. **Ventas sin conexión**: ¿se permiten como «pendiente de confirmar», o la venta se confirma solo con red y sin conexión solo se cotiza y cobra?
4. **Tiempo máximo sin sincronizar** antes de bloquear capturas. Propuesta: 7 días.
5. **Quién usa la app**: VENTAS y GERENCIA seguro. ¿ALMACÉN también (entradas y salidas en bodega sin red)?
6. **Dispositivos y usuarios** (confirmado: **5 usuarios, Android e iOS**): ¿quiénes y con qué rol? ¿Teléfonos propios o de la empresa? ¿Android mínimo? (Propuesta: Android 10 o superior.) ¿Se aprueba cada teléfono nuevo (§4.4)? Para iOS: ¿Ad Hoc o TestFlight? (§6.2 bis).
7. **Pagos en efectivo sin conexión**: ¿requieren foto del comprobante? (Se puede adjuntar y subir al sincronizar.)

## 12. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| El teléfono se pierde con datos sin sincronizar | Aviso de pendientes > 24 h; sincronización automática frecuente; revocación remota |
| Vender sin existencia real | Venta queda «pendiente» hasta que el servidor descuenta; conflicto visible para gerencia; existencias con fecha |
| Diferencias de cálculo teléfono/servidor | Mismo código (`src/domain`) y prueba de paridad obligatoria en CI |
| Precio desactualizado | Ventana de N días + `PriceHistory` + aviso fijo de catálogo viejo |
| Robo del teléfono | Base cifrada, PIN/huella, token revocable, borrado en el siguiente contacto, sin costos para VENTAS |
| Versión vieja de la app | Protocolo versionado, aviso de actualización desde el hosting, versión mínima obligatoria (subiendo pendientes antes) |
| APK compartido con alguien externo | Sin cuenta válida **y** permiso de app móvil no sirve de nada; opcional aprobación de cada teléfono por ADMIN |
| Pérdida de la llave de firma | Llave fuera del repo con doble respaldo (§6.3) |
