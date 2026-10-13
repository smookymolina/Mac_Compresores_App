# Plan Portal de Socios v1.4.0 (G0 aprobado)

Fuente: `docs/prompts/superprompt-portal-socios.md`. Este plan lo **corrige** donde difiere.

## Decisiones
- **Dominio:** `PARTNER_PORTAL_HOST` en `.env`, nunca escrito en el código. El dominio real está pendiente de confirmar con el usuario; el nginx actual sirve `maccompresores.app`, así que lo probable es `socios.maccompresores.app`. En local: `socios.localhost`.
- **Rutas:** las páginas del portal viven en `src/app/(socios)/socios-portal/{page,login,2fa}` y el PNG en `socios-portal/p/[token]/route.ts`.
  - En el host del portal, el middleware reescribe `/x` a `/socios-portal/x` y bloquea `/api/*` y `/_next/image` (solo deja `/_next/static`).
  - En el host interno, `/socios-portal/*` responde 404.
  - El admin interno está en `src/app/(app)/socios`.
- **Setting:** como no existía, se crea el modelo `Setting { key String @id, value Json, updatedAt @updatedAt, updatedById String? @db.Uuid }`. Claves `partners.discountPct`=15 y `partners.dailyQuota`=80. El seed hace upsert con `update:{}` para no pisar lo que cambie el admin.
- **Dependencias:** `otplib` y `sharp` van en `dependencies`. Los dígitos del PNG se dibujan como `<path>` en el SVG, así no hacen falta fuentes en `node:22-slim`.
- **Cookie:** `__Host-mac_partner` (Secure, Path=/, sin Domain, SameSite=Strict). Si `COOKIE_SECURE=false`, se llama `mac_partner`.
- **Detección de host:** se usa `host` sin puerto y en minúsculas. nginx sobrescribe `X-Forwarded-Host $host`. Nunca se confía en el valor que manda el cliente.
- **Bloqueo automático solo por** webdriver, honeypot, cuota excedida o más de 3 ráfagas. La pestaña oculta, devtools, impresión y copia **solo se registran**.

## Código a reutilizar
- **Sesión** (`src/lib/auth/session.ts`): `hashToken` (exportarla), `createSession`, `getCurrentUser`, `requirePermission` y `requirePagePermission`.
- **Permisos:** agregar `"partners.manage"` a `PERMISSIONS` en `src/lib/auth/permissions.ts`. ADMIN ya hereda todos y `prisma/seed.ts` es idempotente.
- **Rate limit** (`src/lib/rate-limit.ts`, guarda en BD): `hit(key, windowMs)`, `isLimited(key,max)` y `clear(key)`. El patrón de uso está en `loginAction` de `src/modules/auth/actions.ts`.
- **IP del cliente:** extraer un helper `clientIp(headers)` en `src/lib/request.ts`, tomando la lógica de `src/lib/share.ts:109`.
- **Búsqueda:** `searchKey()` de `src/lib/search-text.ts`, siguiendo el patrón de `searchProductsAction` en `src/modules/products/actions.ts:55`. **No reutilices** esa acción ni `listProducts`, porque exponen price o el modelo completo.
- **Dinero, validación y errores:** `dec`, `round2` y `D` de `money.ts`; `decimalStr` y `formObject` de `validation.ts`; `AppError`, `ActionResult` y `runAction` de `errors.ts`.
- **Avisos y auditoría:**
  - `notify()` y `usersWithPermission()` en `src/modules/notifications/service.ts`.
  - `sendMail` e `isMailConfigured` en `mail.ts`, `renderEmail` en `email-layout.ts`.
  - `audit()` en `src/lib/audit.ts`, con las etiquetas en `src/modules/audit/labels.ts`.
- **UI:**
  - Menú: `NAV` en `src/app/(app)/layout.tsx`, con la entrada `{href:"/socios",label:"Socios",icon:"partners",group:"Gestión",anyOf:["partners.manage"]}`, y el ícono en `ICONS` de `src/components/shell/nav-links.tsx`.
  - Tabla: `DataTable` en `src/components/ui/data-table.tsx`.
  - Fechas: `fmtDateTime` en `src/lib/utils.ts`.

## Modelos Prisma (migración `20261013000000_partner_portal`)
- `enum PartnerStatus { ACTIVE BLOCKED }`
- `Partner`:
  - Identidad y acceso: `id uuid`, `email @unique`, `name`, `company`, `passwordHash`, `failedLogins Int @default(0)`.
  - 2FA: `totpSecretEnc String?` (AES-256-GCM `iv:tag:ct` base64, llave `PARTNER_TOTP_KEY`), `totpEnabledAt DateTime?`, `totpLastStep Int?`, `backupCodes String[]` (bcrypt).
  - Precio y cuota: `discountPct Decimal(5,2)?`, `dailyQuota Int?`.
  - Estado: `status @default(ACTIVE)`, `blockedReason String?`, `blockedAt DateTime?`, `lastSeenAt DateTime?`.
  - Control: `createdById uuid?`, `createdAt`, `updatedAt`.
- `PartnerSession { id String @id (sha256), partnerId, ip, userAgent, lastActivityAt, expiresAt, createdAt; @@index([partnerId]) }`
- `enum PartnerActivityType { LOGIN_OK LOGIN_FAIL TOTP_OK TOTP_FAIL TOTP_SETUP BACKUP_CODE_USED SEARCH PRICE_VIEW LOGOUT SESSION_REVOKED QUOTA_EXCEEDED RATE_LIMITED AUTO_BLOCK SWEEP_SUSPECT HIDDEN PRINT_ATTEMPT COPY_ATTEMPT CAPTURE_KEY DEVTOOLS WEBDRIVER HONEYPOT ADMIN_CHANGE }`
- `PartnerActivity { id uuid, partnerId, type, meta Json?, ip, userAgent, createdAt; @@index([partnerId, createdAt(sort: Desc)]); @@index([type, createdAt]) }`

## Servicios (`src/modules/partners/*`, todos con `import "server-only"`)
- `session.ts`: `PARTNER_COOKIE`, `createPartnerSession` (borra las sesiones previas), `getCurrentPartner` (30 min de inactividad, 8 h absolutas), `requirePartner` y `destroyPartnerSession`.
- `auth.ts`: verificación de password, `verifyTotp` (ventana ±1 y `totpLastStep`), `consumeBackupCode`, `encryptSecret` y `decryptSecret`.
- `pricing.ts`: `effectiveDiscount(partner)` y `getPartnerPrice(price, pct)`, que calcula `round2(price × (1 − pct/100))`.
- `search.ts`: `searchPartnerProducts(q)` con where `status ACTIVE`, `price > 0` y `searchText contains`. Hace **select únicamente** de `{id, sku, description, unit, currency, price}`, toma 20 y ordena por sku.
- `guard.ts`: `checkLimits(partner, ip)` y `autoBlock(partnerId, reason)`, que avisa al admin con `notify` y `sendMail`.
- `sweep.ts`: `detectSweep(terms[])`, una función pura.
- `token.ts`: `signPriceToken({productId, partnerId, sessionId, exp})` y `verifyPriceToken` (HMAC-SHA256 con `PARTNER_TOKEN_SECRET` y `timingSafeEqual`). El token **no lleva el precio**.
- **Acciones del portal:**
  - `partnerLoginAction`
  - `partnerTotpSetupAction`: devuelve el QR y los códigos de respaldo una sola vez.
  - `partnerTotpVerifyAction`
  - `partnerLogoutAction`
  - `searchPricesAction(term)`: devuelve `{items:{key,sku,description,unit,currency,img}[], remaining}` sin precio en texto.
  - `reportSuspiciousAction(type, meta)`: con lista blanca de tipos y rate limit.
- **Acciones de admin** (cada una con `requirePermission("partners.manage")`, zod y audit):
  - `savePartnerAction`
  - `setPartnerStatusAction`
  - `resetPartner2faAction`
  - `setGlobalPartnerSettingsAction` (pct entre 0 y 60 con 2 decimales, cuota entera)
  - `listPartnerActivity({partnerId?,type?,from?,to?,page})`

## Límites
| Clave | Ventana | Máximo |
|---|---|---|
| `pmin:{partnerId}` | 60 s | 10 |
| `pip:{ip}` | 60 s | 30 |
| `pday:{partnerId}:{fechaMX}` | 24 h | cuota del socio |
| `pburst:{partnerId}:{fechaMX}` | — | más de 3 → autoBlock |
| `plogin:{email}` | — | 5 → BLOCKED |

## Pruebas
- Vitest ya está configurado con `TEST_DATABASE_URL`.
- Playwright: agregar proyectos webkit y firefox, los viewports de 360, 390 y 1280 px, y un proyecto de socios con `baseURL http://socios.localhost:3100`. Para webkit, agregar `socios.localhost` a `/etc/hosts`.
- Para el E2E, un seed solo de prueba con un socio y un secreto TOTP conocido.
