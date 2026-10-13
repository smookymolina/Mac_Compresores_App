# SUPERPROMPT — Portal de Socios Comerciales (Opción C) · MAC Compresores v1.4.0

> Cómo usarlo: en Claude Code, dentro de `/opt/maccompresores`, escribe
> `Lee docs/prompts/superprompt-portal-socios.md y ejecútalo completo.`

---

## 0. Rol y reglas globales (léelas antes de cualquier acción)

Eres el **Orquestador** del desarrollo del Portal de Socios Comerciales de MAC Compresores.
Coordinas a los agentes de este documento. Tú no programas: delegas, revisas las entregas y
abres o cierras cada puerta de calidad (G0–G5).

**Contexto fijo del proyecto (verifícalo con `git log`; no lo supongas):**
- Repositorio en `/opt/maccompresores`, rama de trabajo `release/v1.2.0` (sale de la v1.3.11, commit `affd308`).
- Stack: Next.js 15.5 (App Router), React 19, Tailwind 4, Prisma + PostgreSQL, zod, bcryptjs.
- Docker Compose (`docker-compose.prod.yml`): la app escucha en `127.0.0.1:3080` y el nginx del host
  hace de proxy (`/etc/nginx/sites-enabled/maccompresores`).
- Despliegue solo con `scripts/deploy.sh` (respaldo + build + healthy + builder prune).
- Roles y permisos en la base (`Role`, `Permission`, `RolePermission`). Sesiones guardadas como
  SHA-256 del token (`Session`). Auditoría en `AuditLog` (`src/lib/audit.ts`, etiquetas en `src/modules/audit/labels.ts`).
- Limitador de peticiones existente: `src/lib/rate-limit.ts`. Dinero: `src/lib/money.ts`.
- `Product`: `cost` (Decimal 14,4), `price` (Decimal 14,2) y `currency` (MXN/USD; la TUBERIA siempre va en USD).
  Hay unos 33,884 productos, de los cuales 1,671 tienen precio. Los servicios `SRV-*` valen $0.
- Pruebas: Postgres temporal en Docker (`TEST_DATABASE_URL` y `DATABASE_URL` por variable de entorno).
  Para E2E, la imagen runner con `SEED_DEMO=1` y Playwright (chromium, webkit y firefox ya instalados).
- La app **ya está en producción real** y tiene datos reales: folio C-1, cliente CORVAGLIA CLOSURES y 6 usuarios.

**Reglas no negociables:**
1. **El costo nunca sale del servidor.** Ninguna consulta del portal selecciona `cost`. Usa siempre un `select` explícito, nunca `include` del modelo completo.
2. El precio del socio se calcula **en el servidor**: `precio_socio = price × (1 − descuento/100)`, redondeado con `money.ts`.
3. La UI va en español de México. Debe verse bien en móvil (360 y 390 px) y en escritorio (1280 px).
4. No toques la base de producción ni despliegues sin la aprobación explícita del usuario. Antes de migrar en producción, haz un respaldo `respaldo_pre_v140_*.sql.gz`.
5. Gasta pocos tokens: lee extractos (grep, sed -n), no archivos completos. Respuestas cortas.
6. Cada agente cumple su tarea en **exactamente 5 pasos** y entrega un reporte de un máximo de 15 líneas: qué hizo, archivos tocados, evidencia y riesgos.
7. Commits pequeños por agente, con el mensaje `v1.4.0: <área>: <cambio>`.
8. Sé honesto con el usuario: **en web no se puede impedir al 100% una captura de pantalla.** El objetivo es desalentarla, hacerla inútil y poder rastrear al responsable. Contra el scraping, la meta es que sea inviable a escala.

---

## 1. Alcance funcional (lo que se construye)

**A. Portal de socios en un subdominio propio: `socios.maccompresores.com.mx`**
- Mismo código y misma base, pero con un *route group* `src/app/(socios)` que solo responde cuando el host es el subdominio (lo decide el middleware). La app interna no responde en ese host y el portal no responde en el host principal.
- La autenticación está separada de la interna:
  - Modelo `Partner` (no es `User`) con su propia tabla `PartnerSession`.
  - Cookie `__Host-mac_partner` con `HttpOnly`, `Secure` y `SameSite=Strict`, válida solo en el subdominio.
  - **2FA TOTP obligatorio**, activado con QR en el primer acceso y con códigos de respaldo.
- **Una sola sesión activa por socio.** Si inicia sesión en otro lado, la sesión anterior se revoca.
- La sesión expira a los 30 min de inactividad y a las 8 h como máximo.
- El inicio del socio es una sola pantalla: el buscador de precios. No tiene menú interno.

**B. Consulta de precios (solo precio, nunca costo)**
- **Hay que buscar para ver precios.** Mínimo 3 caracteres y máximo 20 resultados por búsqueda. No existe una lista completa ni la opción de "ver todo".
- Solo aparecen productos con `price > 0` y activos. Los servicios con precio $0 no se muestran.
- Cada resultado muestra SKU, descripción, unidad, moneda y **precio de socio**. La moneda es la del producto y la tubería va en USD. Si el usuario no indica otra cosa, los precios se muestran sin IVA y con la leyenda "Precios sin IVA".

**C. Administración (dentro de la app interna, solo ADMIN, permiso nuevo `partners.manage`)**
- Página `/socios` en la app interna para crear, editar, bloquear o desbloquear un socio y para resetear su 2FA.
- **Descuento:** hay un porcentaje global (en `Setting`, 15% por defecto) y cada socio puede tener el suyo (`Partner.discountPct`, que si es nulo usa el global). Validación entre 0 y 60%, con dos decimales. Cada cambio queda en la auditoría.
- Cuota diaria por socio, configurable (80 búsquedas por defecto).
- **Historial de movimientos por socio** (`PartnerActivity`):
  - Registra inicios de sesión correctos y fallidos, 2FA, cada búsqueda (término, número de resultados), cada vez que se ve un precio, cierres de sesión, bloqueos automáticos y eventos sospechosos (pestaña oculta, intento de imprimir o copiar, devtools, webdriver).
  - Guarda IP, user-agent y fecha y hora en zona de México.
  - La página tiene filtros por socio, tipo de evento y rango de fechas, y paginación.

**D. Anti-captura (desalentar y rastrear)**
- **Marca de agua dinámica**, repetida en diagonal sobre los resultados: nombre del socio, ID corto, fecha, hora e IP. Se dibuja en un `<canvas>`, no en el DOM. Su opacidad es suficiente para leerse en una foto sin estorbar la lectura.
- **Los precios se ven como imagen.** Cada precio es un PNG que genera el servidor (con `sharp`, a partir de un SVG). Las URLs están firmadas con HMAC, duran 60 s y solo sirven para esa sesión. La imagen trae incrustada la marca del socio.
- **Difuminado inmediato** (`filter: blur`) cuando hay `visibilitychange`, `blur` de la ventana o `pagehide`, o cuando se presionan PrintScreen, Cmd+Shift+3/4/5 o Win+Shift+S. Para volver a ver, el usuario toca la pantalla.
- Bloqueo de clic derecho, selección, copiar, arrastrar y la impresión (`@media print`: todo en blanco). Encabezados `Cache-Control: no-store` y `X-Robots-Tag: noindex`.
- Cada intento detectado queda registrado en `PartnerActivity`.

**E. Anti-scraping (que sea inviable a escala)**
- Sin API JSON pública: la búsqueda se hace con Server Actions y respuestas que no son JSON reutilizable. Los precios nunca viajan como texto.
- Límites:
  - Por socio: 10 búsquedas por minuto, además de la cuota diaria.
  - Por IP: 30 búsquedas por minuto.
  - En nginx: `limit_req` por IP en el subdominio.
- **Bloqueo automático:** si se excede la cuota, si hay más de 3 ráfagas, si se detecta `navigator.webdriver` o un navegador headless, o si alguien entra a un enlace trampa (*honeypot*), el socio queda bloqueado y el ADMIN recibe una notificación y un correo.
- Se detectan búsquedas secuenciales sospechosas (barrido alfabético o de prefijos de SKU) y se marcan como sospechosas.
- CSP estricta y `frame-ancestors 'none'`. En `robots.txt` el subdominio va con `Disallow: /`.

---

## 2. Equipo de agentes, orden y puertas de calidad

| # | Agente (`subagent_type`) | Fase | Paralelo con |
|---|---|---|---|
| 1 | Chirurg problemów (Analista) + Plan | Diseño | — |
| 2 | Urbanista danych (Arquitecto de base) | Datos | — |
| 3 | Muzyk sesyjny kodu (Backend Dev) | Backend | 4 |
| 4 | Specjalista od efektów specjalnych (Feature Dev) | Anti-captura / anti-scraping | 3 |
| 5 | Architekt wnetrz aplikacji (Designer) | UI | 3, 4 |
| 6 | Stolarz meblowy UI (Frontend Dev) | Portal + Admin | — |
| 7 | Automatyzuje droge od commita do produkcji (DevOps) | Infra | 6 |
| 8 | Ostatnia linia obrony (QA Security) | QA | 9, 10 |
| 9 | Inspektor jakości z checklista (QA Quality / pruebas) | QA | 8, 10 |
| 10 | Audytor WCAG (Accesibilidad) | QA | 8, 9 |
| 11 | Sedzia sali sadowej QA (QA Manager) | Decisión | — |

**Puertas de calidad:**
- **G0** (después del agente 1): plan aprobado por el usuario.
- **G1** (después del 2): migración aplicada en la base temporal y `npm run typecheck` en verde.
- **G2** (después del 3 y el 4): pruebas unitarias en verde, y un grep demuestra que `cost` no aparece en `src/app/(socios)` ni en `src/modules/partners`.
- **G3** (después del 6 y el 7): el portal funciona en staging local con el host del subdominio.
- **G4** (después del 8, el 9 y el 10): sin hallazgos críticos ni altos abiertos.
- **G5** (después del 11): veredicto GO y aprobación del usuario para desplegar.

**Plugins y skills que deben usarse (con la herramienta Skill):**
- Diseño y frontend:
  - `frontend-design:frontend-design`
  - `vectorlab-ux-skills:page-patterns`, `viewports`, `empty-states`, `loaders`, `errors`, `forms`, `labels`, `verbs`, `keyboard`
  - `vectorlab-ux-skills:ux-audit` (al cerrar)
- Accesibilidad: `a11y-enforcer:a11y-check`, `a11y-enforcer:contrast`
- Auditorías de plan y código:
  - `audit-suite:audit-as-frontend-eng`, `audit-as-backend-eng`, `audit-as-perf-eng`, `audit-as-prod-readiness`
  - `audit-suite:vercel-react-best-practices`
- Revisión final: `security-review`, `code-review` (nivel high) y `engineering:testing-strategy`
- Verificación visual: `run` (levantar la app y tomar capturas con Playwright)

---

## 3. Instrucciones por agente (5 pasos cada uno)

### Agente 1 — Analista + Plan
1. Lee extractos de `prisma/schema.prisma` (Role, User, Session, Product, Setting, AuditLog), del middleware, de `src/lib/auth`, `src/lib/rate-limit.ts` y de `src/modules/products`.
2. Divide el alcance del punto 1 en tareas atómicas y anota sus dependencias y complejidad (S, M o L).
3. Define el contrato de datos y de acciones: modelos nuevos, Server Actions, rutas y permisos.
4. Enumera los riesgos (fuga de `cost`, choque de cookies entre hosts, TOTP con desfase de reloj, rendimiento de `sharp`) con su mitigación.
5. Entrega `docs/partners-plan.md` y **detente en G0** para que el usuario lo apruebe.

### Agente 2 — Arquitecto de base
1. Diseña los modelos `Partner` (email único, nombre, empresa, passwordHash, totpSecret cifrado con AES-256-GCM y llave en `.env`, backupCodes hasheados, discountPct nullable, dailyQuota, status ACTIVE/BLOCKED, blockedReason, lastSeenAt), `PartnerSession` y `PartnerActivity` (con su enum de tipo, campo `meta Json`, IP y UA). Agrega los índices `(partnerId, createdAt DESC)` y `(type, createdAt)`.
2. Agrega a `Setting` las claves `partners.discountPct=15` y `partners.dailyQuota=80`, y el permiso `partners.manage` asignado solo a ADMIN.
3. Crea la migración Prisma y un seed idempotente para el permiso y los settings. No crees socios demo en producción.
4. Aplica la migración en el Postgres temporal y corre `prisma validate` y `npm run typecheck`.
5. Reporta y abre **G1**.

### Agente 3 — Backend Dev
1. Crea `src/modules/partners/` con auth (bcrypt, bloqueo tras 5 intentos fallidos, TOTP con `otplib` y ventana ±1, códigos de respaldo) y sesiones (una activa por socio, expiración por inactividad y absoluta).
2. Agrega precios: `getPartnerPrice(product, partner)`, que toma el descuento del socio o el global y usa `money.ts`. Agrega la búsqueda `searchPartnerProducts(q)` con `select` sin `cost`, que reutiliza `searchText`/unaccent, filtra `price > 0` y activos, y limita a 20 resultados.
3. Agrega límites y bloqueo: integra `rate-limit.ts` por socio y por IP, la cuota diaria, la detección de barridos y `autoBlock()`, que avisa al ADMIN por notificación y por correo con `mail.ts`.
4. Agrega las acciones de ADMIN: CRUD de socios, cambio de descuento global y por socio, reset de 2FA, desbloqueo, y consulta paginada de `PartnerActivity` con filtros. Todas validadas con zod y auditadas.
5. Escribe las pruebas unitarias (cálculo de precio, redondeo, MXN y USD, cuota, bloqueo, que no haya `cost` en la salida), ejecútalas y reporta.

### Agente 4 — Feature Dev (anti-captura y anti-scraping)
1. Crea el endpoint `src/app/(socios)/p/[token]/route.ts`. El token es HMAC de (productId, partnerId, sessionId, exp de 60 s). Genera el PNG del precio con `sharp` a partir de un SVG, con la marca del socio incrustada y ruido leve. Responde con `no-store`.
2. Crea el componente cliente `<Watermark>`, que dibuja en canvas en mosaico diagonal (nombre, ID, fecha, hora, IP) y se redibuja con cada resize y cada minuto.
3. Crea el hook `useCaptureShield()`: difumina con visibilitychange, blur, pagehide y las teclas de captura; bloquea contextmenu, copy, selectstart, dragstart y beforeprint; detecta `navigator.webdriver` y devtools por diferencia de tamaño. Cada evento se reporta a una Server Action que lo guarda en `PartnerActivity`.
4. Configura las cabeceras del subdominio en el middleware (CSP estricta, `frame-ancestors 'none'`, `X-Robots-Tag`, `no-store`) y los enlaces honeypot ocultos que bloquean al socio si alguien los sigue.
5. Prueba que el token expira, que no sirve en otra sesión y que el PNG no expone el precio en texto (ni en el nombre del archivo ni en metadatos). Reporta y, junto con el agente 3, abre **G2**.

### Agente 5 — Designer
1. Carga `frontend-design:frontend-design` y `docs/design-system.md`. Reutiliza los tokens existentes de la app y no inventes una identidad nueva.
2. Con `vectorlab-ux-skills:page-patterns` define el patrón *list + search* para el portal y *list / detail / settings* para el admin.
3. Diseña los estados del portal: login, configuración de 2FA, buscador vacío, cargando (skeleton), resultados, sin resultados, cuota agotada, bloqueado y vista difuminada. Hazlo para 360/390 px (tarjetas) y 1280 px (tabla).
4. Diseña el admin: lista de socios, formulario de socio, ajuste de descuento global e historial con filtros. Valida el contraste con `a11y-enforcer:contrast`.
5. Entrega las especificaciones (tokens, componentes y textos en verbo primero según `vectorlab-ux-skills:verbs`) a los agentes 6 y 10.

### Agente 6 — Frontend Dev
1. Construye las páginas `(socios)`: `/login`, `/2fa` (QR con el paquete `qrcode`, que ya está instalado) y `/` (buscador). El buscador usa *debounce* de 400 ms y como mínimo 3 caracteres.
2. Muestra los resultados en tarjetas en móvil y en tabla en escritorio, con el precio como `<img>` firmada y `alt="Precio protegido"`, `<Watermark>` y `useCaptureShield()` montados, y la leyenda de moneda e IVA.
3. Construye el admin `/socios` en la app interna, protegido con `partners.manage`. Reutiliza `<DataTable mobileCards>`, `.table-stack`, `.dialog-actions` y `.tap`.
4. Agrega las etiquetas nuevas a `src/modules/audit/labels.ts` y el enlace "Socios" al menú, visible solo para ADMIN.
5. Ejecuta `typecheck` y `lint`, y con el skill `run` levanta la app con el host del subdominio (`/etc/hosts` local o la cabecera `Host`). Toma capturas en 390 y 1280 px y abre **G3** junto con el agente 7.

### Agente 7 — DevOps
1. Prepara (sin aplicar) el bloque nginx para `socios.maccompresores.com.mx`: proxy a `127.0.0.1:3080`, `limit_req_zone` de 30 r/m por IP con burst 10, `client_max_body_size` pequeño, HSTS y bloqueo de user-agents de bots conocidos.
2. Documenta en `docs/deploy-socios.md` el registro DNS A o CNAME que hay que crear en GoDaddy y el certificado con `certbot --nginx -d socios.maccompresores.com.mx`.
3. Agrega a `.env.example` las variables `PARTNER_PORTAL_HOST`, `PARTNER_TOKEN_SECRET` y `PARTNER_TOTP_KEY`, y genera los valores con `openssl rand`. **No los imprimas en el chat.**
4. Verifica que `sharp` y `otplib` compilen en la imagen Docker (alpine o debian) y que `scripts/deploy.sh` siga funcionando sin cambios.
5. Escribe el plan de despliegue y el de *rollback* (respaldo `respaldo_pre_v140_*`, revertir la migración, quitar el bloque nginx). No lo ejecutes hasta G5.

### Agente 8 — QA Security
1. Ejecuta `security-review` y `audit-suite:audit-as-backend-eng` sobre el diff de la v1.4.0.
2. Busca fugas de `cost` con grep en `(socios)`, `modules/partners`, respuestas de Server Actions y props serializadas (revisa el payload RSC con Playwright).
3. Verifica el aislamiento: la cookie de socio no sirve en el host interno ni al revés, un socio no entra a rutas internas y un usuario interno no entra al portal.
4. Prueba la autenticación: fuerza bruta (bloqueo), reutilización de un TOTP, sesión robada después de un nuevo login, IDOR en el endpoint de precio y CSRF en las acciones de admin.
5. Entrega los hallazgos con severidad y remediación. Los críticos y altos regresan al agente 3, 4 o 6.

### Agente 9 — QA Quality / pruebas
1. Aplica `engineering:testing-strategy` para cubrir el precio (15% global, descuento por socio, MXN y USD, redondeo), la cuota, el bloqueo y el historial.
2. Escribe E2E con Playwright en chromium, webkit y firefox, en 360, 390 y 1280 px: login con 2FA, búsqueda, difuminado al cambiar de pestaña, impresión en blanco y cuota agotada.
3. **Simula el scraping** con un script que barre de "a" a "z" y de "aa" a "zz". Debe terminar bloqueado, con `PartnerActivity` registrado y el ADMIN notificado. Repite con `navigator.webdriver=true`, que debe bloquear de inmediato.
4. Desde el panel de ADMIN cambia el descuento a 20%: la siguiente búsqueda refleja el precio nuevo y el historial lo muestra.
5. Ejecuta `npm test` y `npm run test:e2e` en la base temporal y reporta resultados con números (pasaron/fallaron).

### Agente 10 — Accesibilidad
1. Ejecuta `a11y-enforcer:a11y-check` en las páginas del portal y del admin.
2. Revisa contraste (`a11y-enforcer:contrast`), foco visible y navegación con teclado (`vectorlab-ux-skills:keyboard`).
3. Verifica que los precios en imagen tengan una alternativa accesible que no filtre el número. Explica la decisión: se acepta el balance entre seguridad y accesibilidad, y se documenta.
4. Comprueba que los objetivos táctiles midan 44 px o más y que no haya scroll horizontal en 360 px (`vectorlab-ux-skills:viewports`).
5. Entrega los hallazgos con prioridad. Los que bloquean regresan al agente 6.

### Agente 11 — QA Manager
1. Consolida los reportes de los agentes 8, 9 y 10, junto con `code-review` (high) y `vectorlab-ux-skills:ux-audit`.
2. Califica la entrega del 1 al 10 en seguridad, calidad, UX y rendimiento.
3. Confirma que todos los hallazgos críticos y altos estén cerrados y que exista evidencia (pruebas y capturas).
4. Emite el veredicto **GO** o **NO-GO** con el orden de corrección. Si es NO-GO, regresa al agente responsable (máximo 2 vueltas).
5. Si es GO, presenta al usuario el resumen, el plan de despliegue del agente 7 y la lista de acciones manuales (DNS en GoDaddy, certbot). **Espera la aprobación (G5)** y solo entonces: respaldo, `scripts/deploy.sh`, verificación en producción, push a `release/v1.2.0` y `main`, y actualización de la memoria del proyecto.

---

## 4. Definición de terminado (Definition of Done)
- [ ] El socio entra solo por `socios.maccompresores.com.mx` con contraseña y 2FA, y ve únicamente el buscador de precios.
- [ ] El precio mostrado es `price × (1 − descuento)` con el descuento del socio o el global, que el ADMIN edita. `cost` no aparece en ninguna respuesta.
- [ ] El historial completo del socio se puede ver y filtrar en `/socios` (solo ADMIN).
- [ ] Hay marca de agua, difuminado, bloqueo de impresión y copia, y los precios se muestran como imagen firmada.
- [ ] Hay límites por socio y por IP, cuota diaria, bloqueo automático con aviso, honeypot y detección de webdriver.
- [ ] Funciona en móvil (360/390 px) y escritorio (1280 px) en chromium, webkit y firefox.
- [ ] Pruebas unitarias y E2E en verde, sin hallazgos críticos ni altos, y veredicto GO.
- [ ] Desplegado con respaldo, push hecho y memoria actualizada (solo después de la aprobación del usuario).
