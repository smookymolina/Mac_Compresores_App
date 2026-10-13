# QA Security — Portal de socios v1.4.0

Agente 8 (QA Security). Rama `release/v1.2.0`, diff `affd308..HEAD` (7708f19..7018abf). Solo reporte; no se corrigió código.

## Alcance y método

- Revisión manual del diff: `src/modules/partners/*`, `src/middleware.ts`, `src/app/(socios)/**`, `src/app/(app)/socios-admin/**`, `src/lib/price-image.ts`, `src/lib/request.ts`, `docs/nginx-socios.conf`.
- La skill `security-review` no se pudo cargar: exige que el cwd sea un repo git y el agente arranca en `/root`. Se aplicaron sus criterios a mano.
- Prueba en vivo: `next dev` en :3102 (COOKIE_SECURE=false, secretos de prueba con `openssl rand`), BD temporal en :55432, socios propios `sec-{a,b,c,d}@test.local` (ya borrados), Playwright Chromium con `--disable-blink-features=AutomationControlled`.
- **Limitación:** el host tiene 3.9 GB de RAM y los servidores de E2E (:3100) y a11y (:3101) corrían al mismo tiempo. El kernel mató por OOM el dev server de :3102 dos veces, justo después de la primera búsqueda. Se esperaron ~40 min y la memoria nunca bajó. Lo que no se probó en vivo queda como **[estático]**: viene de leer el código, y la cobertura de tests existente se cita donde aplica.

## Resumen

| Severidad | Conteo |
|---|---|
| Crítico | 0 |
| Alto | 1 |
| Medio | 2 |
| Bajo | 4 |
| Info | 5 |

## Hallazgos

### SEC-01 — Alto — La IP del cliente se puede falsificar con X-Forwarded-For (evade el límite por IP y contamina bitácora y marca de agua)

- **Archivo:** `src/lib/request.ts:11` (`clientIp` toma el **primer** valor de XFF). Proxy: `docs/nginx-socios.conf:46` (y los dos `location` siguientes) usa `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, que **añade** la IP real al final de la XFF que mandó el cliente.
- **Impacto:** `checkLimits` (`guard.ts:88`, `pip:${ip}` de 30/min) se evade cambiando la XFF en cada petición. Por eso varias cuentas de socio coludidas desde una sola IP no quedan limitadas en la app; el `limit_req` de nginx por `$binary_remote_addr` sí sigue frenando. Además, la IP que se guarda en `PartnerActivity`/`PartnerSession` y la que se pinta en la marca de agua del PNG (`p/[token]/route.ts:34-39`) y en la página (`socios/page.tsx:33`) las controla el atacante, así que una fuga ya no se puede atribuir por IP. Afecta también a `adminCtx` (`admin-actions.ts:36`).
- **Evidencia (reproducible):**
  ```
  node -e 'const f=h=>h.get("x-forwarded-for")?.split(",")[0]?.trim()||h.get("x-real-ip")?.trim()||"desconocida";
  const H={"x-forwarded-for":"6.6.6.6, 203.0.113.9","x-real-ip":"203.0.113.9"};console.log(f({get:k=>H[k]??null}))'
  # → 6.6.6.6   (nginx entrega "6.6.6.6, <ip real>" si el cliente manda "X-Forwarded-For: 6.6.6.6")
  ```
  En producción: `curl -H 'X-Forwarded-For: 1.2.3.4' https://maccompresores.app/socios/...` → la fila `PartnerActivity.ip` queda en `1.2.3.4`.
- **Remediación:** en `clientIp` dar prioridad a `X-Real-IP` (nginx la fija con `$remote_addr`, y el cliente no la puede sobrescribir) o tomar el **último** valor de XFF. Alternativa: en nginx, `proxy_set_header X-Forwarded-For $remote_addr;` en los tres `location` de socios. Añadir un test unitario con XFF `"spoof, real"`.

### SEC-02 — Medio — Quien tenga la contraseña temporal puede enrolar el 2FA, y la contraseña temporal no caduca ni hay que cambiarla

- **Archivo:** `src/modules/partners/portal-actions.ts:49-60` (`partnerTotpSetupAction`), `admin-actions.ts:63-67` (contraseña temporal) y `admin-actions.ts:97-108` (`resetPartner2faAction`).
- **Detalle:** mientras `totpEnabledAt` sea null, cualquiera que pase la contraseña obtiene la cookie previa y puede llamar a la acción de alta: recibe el secreto TOTP y los códigos de respaldo, y con eso activa el 2FA en **su** dispositivo. El primero que llegue se queda con la cuenta, porque el socio legítimo ya no puede enrolar (`CONFLICT`). Pasa lo mismo después de cada «reset 2FA» del admin. La contraseña temporal es permanente: no existe flujo para cambiarla, ni vencimiento, ni bandera `mustChangePassword`. Además, cada nueva llamada a la acción de alta regenera el secreto (`:56`), así que un tercero con la contraseña puede interferir con el alta del socio legítimo mientras está en curso.
- **Evidencia [estático]:** el flujo `login → partnerTotpSetupAction → partnerTotpVerifyAction` no exige ningún factor fuera de banda; lo cubre `tests/integration/partners.test.ts:211`.
- **Remediación:** (a) poner vencimiento a la contraseña temporal (p. ej. 72 h, campo `tempPasswordExpiresAt`) y obligar a cambiarla antes del alta del 2FA; (b) alternativa o complemento: entregar un enlace de enrolamiento de un solo uso y con vencimiento, en lugar de contraseña + alta libre; (c) no regenerar el secreto si ya existe uno pendiente con menos de 10 min de antigüedad; (d) avisar al admin (notificación) cuando se active el 2FA.

### SEC-03 — Medio — El bloqueo por intentos no es atómico con la verificación: un lote concurrente prueba más de 5 contraseñas o códigos

- **Archivo:** `src/modules/partners/auth.ts:54-66` (`isLimited` y `status` se leen **antes** del bcrypt; `hit`/`registerFailure` se cuentan **después**); `portal-actions.ts:72-86` (2FA: `getPendingPartner` valida ACTIVE al inicio, y tras `ok` se crea la sesión sin volver a comprobar).
- **Impacto:** N peticiones en paralelo (o N cookies previas) pasan todas la comprobación inicial y se evalúan. Con la contraseña, eso sirve de oráculo: la que acierta recibe un `303 → /socios/2fa` aunque la cuenta quede bloqueada por las demás. En TOTP, las N adivinanzas de un lote se evalúan antes del bloqueo. La cuenta termina bloqueada (el ataque hace ruido), pero se confirma la contraseña.
- **Evidencia [estático]:** el orden de las operaciones en las líneas citadas. Para reproducir: 20 `POST /socios/login` simultáneos con la acción de login (19 contraseñas erróneas + 1 correcta) → una responde 303 y el socio queda `BLOCKED`.
- **Remediación:** reservar el intento **antes** de verificar: `n = await hit(rlKey)` y rechazar si `n > 5`, y solo hacer `clear` al acertar. Hacer igual con un `hit` por socio en el paso de 2FA. Antes de `createPartnerSession`, volver a leer `status === "ACTIVE"` y `failedLogins < 5`. Añadir también un límite por IP real en el login (frena el password spraying entre muchos correos).

### SEC-04 — Bajo — La cookie previa al 2FA es reutilizable y no está ligada a un estado del socio

- **Archivo:** `src/modules/partners/session.ts:39-55`.
- **Detalle:** el token pre-2FA está firmado con HMAC (clave derivada de `PARTNER_TOKEN_SECRET` con separación de dominio), vence a los 10 min y lleva el id del socio. Bien. Pero no tiene estado: `clearPendingPartner` solo borra la cookie del navegador, así que una copia del valor sigue sirviendo 10 min para más intentos de 2FA o de alta, incluso después de un login exitoso, de un reset de 2FA o de un desbloqueo. Tampoco cambia si cambia el hash de la contraseña.
- **Remediación:** incluir en el token un nonce guardado en BD (o `passwordHash`/`updatedAt` del socio) e invalidarlo al usarlo con éxito, y también en reset 2FA, bloqueo o desbloqueo.

### SEC-05 — Bajo — Carrera de «lost update» al consumir códigos de respaldo distintos a la vez

- **Archivo:** `src/modules/partners/auth.ts:129-133`.
- **Detalle:** `fresh` se lee fuera de la escritura y luego se escribe la lista completa (`data: { backupCodes: fresh.filter(...) }`). Si dos peticiones consumen los códigos A y B al mismo tiempo, la segunda escritura restaura A y lo deja reutilizable. Para un mismo código sí es atómico (`has: hash`); lo cubre `partners.test.ts:103`.
- **Remediación:** usar un UPDATE atómico, `UPDATE "Partner" SET "backupCodes" = array_remove("backupCodes", $hash) WHERE id=$id AND $hash = ANY("backupCodes")` con `$executeRaw`, o meter la operación en una transacción `SERIALIZABLE`.

### SEC-06 — Bajo — Cualquiera que conozca el correo de un socio puede bloquear su cuenta (DoS)

- **Archivo:** `src/modules/partners/auth.ts:60-63`.
- **Detalle:** 5 contraseñas erróneas → `BLOCKED` permanente hasta que lo resuelva un admin, sin pasar por el segundo factor. Es una decisión de diseño (lo pide la especificación), pero se puede usar como DoS dirigido contra un socio.
- **Remediación:** bloqueo temporal (p. ej. 15 min) en la fase de contraseña y bloqueo permanente solo tras fallos de 2FA o señales de scraping; o exigir CAPTCHA a partir del 3.er fallo.

### SEC-07 — Bajo — CSP con `'unsafe-inline'` en `script-src`

- **Archivo:** `src/middleware.ts:28`.
- **Detalle:** si apareciera una XSS, la CSP no la frena. En dev además está `'unsafe-eval'`; en producción no (se condiciona a `NODE_ENV`).
- **Remediación:** CSP con nonce por petición en el middleware (`x-nonce` + `script-src 'nonce-…' 'strict-dynamic'`), que Next 15 soporta.

### SEC-08 — Info — Sin fuga de costo ni de precios en texto (verificado en vivo)

- `grep -rniE "\bcost"` en `src/components/socios`, `src/components/partners`, `src/app/(socios)` y `src/modules/partners` → sin coincidencias (solo `BCRYPT_COST`/`BACKUP_COST`).
- Respuesta real de `searchPricesAction` (búsqueda «separador», producto SEP: lista 1500, costo 1000, socio 1275.00):
  `{"ok":true,"data":{"items":[{"key":"5abd…","sku":"SEP","description":"Separador","unit":"PZA","currency":"MXN","img":"/socios/p/eyJ…"}],"remaining":79}}`.
  `grep -E "cost|1500|1275|1,275|\"price"` sobre todas las respuestas HTML/RSC/acciones de `/socios/*` capturadas → 0 coincidencias. `search.ts` usa `select` explícito y `price` se queda en el servidor. El PNG dibuja los glifos como `<path>` (no hay `<text>` en el SVG).
- **No se pudo** capturar el HTML de `GET /socios` posterior al login: el OOM descrito arriba lo impidió. Por código, `page.tsx` solo pasa `remaining`, `quota`, `resetOn`, contacto y marca de agua (nombre, id corto, IP), sin precios.

### SEC-09 — Info — Aislamiento de sesiones correcto [estático, salvo cabeceras]

- La cookie del socio tiene `Path=/socios`, `HttpOnly`, `SameSite=Strict` y `__Secure-` en producción. El navegador no la envía a `/`, `/api` ni `/socios-admin`, y aunque se envíe a mano el middleware exige `mac_session` (`middleware.ts:79`). `isPortalPath` no captura `/socios-admin`.
- Acciones de admin: todas empiezan con `requirePermission("partners.manage")` (`admin-actions.ts:49,76,99,115`) y las consultas también (`queries.ts:15,30,51,74,80`). Con la sesión de un socio fallan con UNAUTHENTICATED.
- Acciones del portal: `requirePartnerAction`/`getPendingPartner` solo leen la cookie del socio. Con `mac_session` fallan.
- IDOR en `/socios/p/[token]` (`route.ts:18-24`): firma HMAC con `timingSafeEqual`, TTL de 60 s, y exige `partnerId === sesión` **y** `sessionId === sesión`. Un token de otro socio, de una sesión anterior, vencido o alterado devuelve 404 sin detalle. Sin cookie también devuelve 404 (middleware).
- Una sola sesión por socio: `createPartnerSession` borra las anteriores en una transacción y registra `SESSION_REVOKED`.
- TOTP: ventana de ±1 paso, anti-reuso atómico con `totpLastStep` (lo cubren `partners.test.ts:80,96`). Secreto cifrado con AES-256-GCM.
- Búsqueda: se quitan `%`, `_` y `\` (`search.ts:25-26`) y Prisma parametriza. `hit()` usa `$queryRaw` con plantilla parametrizada.

### SEC-10 — Info — Cabeceras, robots, CSRF y open redirect

- En las respuestas capturadas de `/socios/*`: `Content-Security-Policy` (con `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'self'`), `X-Robots-Tag: noindex, nofollow`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `nosniff`. `robots.ts` hace `disallow: /socios`. El layout lleva `robots: { index:false }`. El PNG va con `no-store` y `nosniff`.
- CSRF: las Server Actions de Next 15 comparan `Origin` con `Host`/`X-Forwarded-Host` (nginx manda `X-Forwarded-Host $host`), y la cookie es `SameSite=Strict`. No hay `serverActions.allowedOrigins` que lo amplíe.
- Open redirect: todos los `redirect()` del portal van a rutas fijas (`/socios`, `/socios/login`, `/socios/2fa`), y el middleware vacía `search`. No se encontraron.

### SEC-11 — Info — `reportSuspiciousAction` y honeypots

- `shield-actions.ts`: lista blanca de tipos, `meta` saneada (máx. 8 claves escalares cortas), exige sesión, límite de 20/min por socio. Solo `WEBDRIVER` bloquea. Como el cliente puede no mandar nunca el evento, la detección es solo orientativa. Además, el socio puede autobloquearse llamando a la acción, aunque eso no afecta a terceros.
- Los honeypots (`/socios/api-precios`, `/socios/catalogo-completo`) son `<a>` simples (no `<Link>`, así que Next no los precarga), ocultos y con `tabIndex=-1`. Riesgo de falso positivo: extensiones de navegador que precargan enlaces o lectores en modo texto pueden bloquear a un socio legítimo. Conviene monitorear los `HONEYPOT` en la bitácora.

### SEC-12 — Info — El token del PNG expone el `sessionId` (hash de la cookie)

- `token.ts:25` incluye `s: sessionId` (sha256 del token de cookie = PK de `PartnerSession`) en un JSON base64 legible. No permite suplantar a nadie (hace falta la cookie), pero filtra un identificador interno.
- **Remediación opcional:** usar en su lugar un HMAC truncado del sessionId, o cifrar el cuerpo.

## Pendiente de verificación en vivo (bloqueado por OOM del host)

Brute force con bloqueo a 5 vía HTTP, reuso de TOTP vía HTTP, backup de un solo uso vía HTTP, revocación de la sesión anterior, Origin cruzado en Server Actions, límite de 20/min de `reportSuspiciousAction` y HTML de `GET /socios`. Las suites de integración ya cubren la lógica equivalente (líneas citadas). Hay que repetir las pruebas cuando el host tenga ≥1.5 GB libres, o contra un `next start`.
