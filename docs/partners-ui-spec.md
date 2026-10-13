# Especificación UI — Portal de Socios y Admin de Socios (v1.4.0)

Alcance: solo especificación para Frontend (agente 6) y Accesibilidad (agente 10). Sin identidad nueva: se usan los tokens de `src/app/globals.css`, los componentes de `src/components/ui` y `docs/design-system.md`. Manda `docs/partners-plan.md` (rutas `socios-portal/*`, admin en `(app)/socios`).

## 1. Tokens y clases a reutilizar (no crear colores)
- Superficies/texto: `bg-surface`, `bg-panel`, `bg-panel-2`, `border-line`, `text-ink`, `text-ink-soft`, `text-muted`, `text-accent-fg`, `text-danger`. Tema `light-dark()` heredado (el portal también sigue `prefers-color-scheme`).
- Clases: `.btn .btn-primary|secondary|danger|ghost`, `.input`, `.label`, `.toolbar`, `.search`, `.table`, `.mono`, `.num`, `.skeleton`, `.logo-tile`, `.tap`, `.dialog-actions`, `.auth-*` (login y 2FA reutilizan `AuthShell`), `Badge`, `Card`, `EmptyState`, `FilteredEmpty`, `ErrorState`, `Pager`, `Dialog`, `Field`, `PasswordField`, `SelectField`, `ActionForm`, `useToast`.
- Tipografía: Plex Sans 14 px cuerpo, 12 px solo meta (leyenda, ayudas, contador), Plex Mono 13 px para SKU, IP y fecha. Pesos 400/500/600. En móvil `.input` ya sube a 16 px (evita zoom iOS).
- Espaciado base 4 px (`--space-*`, Tailwind `gap-2|3|4`). Radios 3/4/6. Sin gradientes, sin emojis, iconos `lucide-react` `strokeWidth` 1.75.
- Objetivo táctil: el portal es móvil primero. `.btn` y `.input` solo suben a 44 px con `pointer: coarse`; en el portal se fuerza siempre (un iPad con teclado también cuenta):
```css
.portal .btn, .portal .input, .portal .tap { min-height: var(--hit); }   /* 44 px */
.portal-main { max-width: 64rem; margin-inline: auto; padding: 1rem; }    /* 360: 328 px útiles */
.portal-main :where(p, td) { overflow-wrap: anywhere; }
.portal-img { height: 2rem; width: auto; max-width: 100%; display: block; }  /* 32 px ≥ 28 px */
```
- Movimiento: solo `opacity`/`transform` con `--dur-fast|--dur`; el skeleton usa `pulse` y se apaga con `prefers-reduced-motion`. El difuminado es instantáneo (sin transición) por seguridad.

## 2. Patrones de página
- Portal = **list + search** en una sola pantalla: sin sidebar ni menú; encabezado + buscador + resultados + leyenda. `/login` y `/2fa` son pantallas de acceso (`AuthShell`, sin animaciones nuevas).
- Admin = **list** `/socios`, **detail/form** `/socios/nuevo` y `/socios/[id]`, **settings** `/socios/ajustes` (ruta nueva; el plan no la fija, Frontend puede ajustarla), **log** `/socios/historial`. Todo con `PageHeader`, `Card`, `Pager`; una acción primaria por vista.

## 3. Árbol de componentes del portal (`src/components/socios/*`, cliente salvo indicación)
```
PortalShell (server) {partner:{name,company,shortId}, ip, contact?:{email?,phone?}}
├─ PortalHeader {name, company}            logo .logo-tile | nombre·empresa (truncate) | <form action=partnerLogoutAction>Cerrar sesión (.btn-ghost, 44 px)</form>
├─ <main id="contenido" class="portal-main shield-target">
│   └─ PriceSearch {remaining:number, quota:number, blockedUntil?:Date, resetAt:string}
│       ├─ SearchBar {value,onChange,disabled,minChars=3}   <label>Buscar producto</label> + .input + botón "Buscar" + hint
│       ├─ QuotaCounter {remaining, quota}                  aria-live="polite"
│       ├─ ResultsRegion {status:'idle'|'loading'|'results'|'empty'|'quota'|'rate'|'error', items, q, capped:boolean}
│       │   ├─ ResultsList → <table class="table portal-table"> (una sola marcación; ver §5)
│       │   ├─ ResultsSkeleton {rows=3} (solo si la espera pasa de 300 ms)
│       │   └─ EmptyState / ErrorState reutilizados
│       └─ Legend  "Precios sin IVA · moneda indicada por producto"
├─ Watermark {text:string[], angle,size,…} (canvas fijo, pointer-events:none, aria-hidden, z-30)
└─ ShieldOverlay {hidden:boolean, onReveal} (z-40)
PriceImg {src, w, h, alt="Precio protegido"}  CurrencyChip {currency:'MXN'|'USD'}  (= Badge neutral / blue)
```
Páginas `/login`, `/2fa` (`TotpSetup`, `TotpVerify`, `BackupCodes {codes:string[], onDone}`) fuera de `shield-target`.

## 4. Estados del portal (microcopy exacto, español MX, verbo primero)
Todos los mensajes de error: sin culpar al usuario y con una salida. Región `role="status"` para estados, `role="alert"` solo para error de formulario.

| Estado | Título / cuerpo | Acción |
|---|---|---|
| Login | «Inicia sesión» · «Consulta tus precios de socio de MAC Compresores.» Campos: «Correo electrónico», «Contraseña» | «Iniciar sesión» |
| Login: datos incorrectos | «No pudimos iniciar sesión con esos datos. Revisa tu correo y contraseña, o contacta a MAC Compresores.» (genérico, no revela cuál falló) | foco al campo correo |
| Login: demasiados intentos | «Hay demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.» | — |
| Sesión terminada | «Tu sesión terminó por inactividad. Inicia sesión de nuevo.» / «Se abrió tu cuenta en otro dispositivo. Inicia sesión de nuevo si fuiste tú.» | «Iniciar sesión» |
| 2FA paso 1 | «Activa la verificación en dos pasos» · «1. Escanea este código QR con Google Authenticator, Microsoft Authenticator o Authy.» QR 192 px sobre ficha blanca (`#000` sobre `#fff`, 21:1) con relleno 12 px. Debajo «¿No puedes escanear? Escribe esta clave en tu app:» (mono) | — |
| 2FA paso 2 | «2. Escribe el código de 6 dígitos que muestra tu app.» Campo «Código de 6 dígitos» (`inputMode=numeric autocomplete=one-time-code`) | «Activar verificación» |
| 2FA código incorrecto | «Ese código no coincide. Espera al siguiente código de tu app e inténtalo de nuevo. Si sigue fallando, activa la hora automática en tu teléfono.» | — |
| Códigos de respaldo (una sola vez) | Aviso `--warn-soft`: «Guarda estos códigos ahora. No volverás a verlos y cada uno sirve una sola vez.» Rejilla de 10 códigos mono, 2 columnas | «Copiar códigos», «Descargar códigos», y primario «Ya los guardé» (habilitado tras copiar/descargar o tras 3 s) |
| Verificar código | «Verifica tu identidad» · campo «Código de 6 dígitos» · enlace «Usar un código de respaldo» (cambia a «Código de respaldo») | «Verificar código» |
| Buscador vacío | Etiqueta «Buscar producto», placeholder «SKU o descripción». Pista bajo el campo: «Escribe al menos 3 caracteres: SKU o descripción» (no es error; sin icono rojo) | botón «Buscar» |
| Cargando | 3 filas skeleton, `aria-busy="true"`, `sr-only` «Buscando precios…». Solo si tarda >300 ms; antes se conserva el resultado anterior | — |
| Resultados | Encabezado «{n} resultados» (singular «1 resultado»). Si n=20: «Mostrando hasta 20 resultados; afina tu búsqueda» (icono `Info`, `text-ink-soft`) | — |
| Sin resultados | Icono `SearchX` · «No encontramos “{q}”» · «Revisa el SKU o prueba con otra parte de la descripción.» | «Borrar búsqueda» |
| Contador | «Te quedan {r} de {n} búsquedas hoy» (`text-sm text-ink-soft`). Con r ≤ 10: `Badge amber` «Te quedan {r} búsquedas hoy» | — |
| Límite por minuto | «Haz una pausa de {s} segundos para seguir buscando.» (campo deshabilitado con cuenta regresiva) | — |
| Cuota agotada | Icono `Clock` · «Llegaste al límite de búsquedas de hoy» · «Tu cuota ({n} búsquedas) se reinicia hoy a las 12:00 a. m., hora de Ciudad de México ({dd/mm/aaaa}). ¿Necesitas más? Contacta a MAC Compresores.» Campo y botón deshabilitados, contador «0 de {n}» | contacto |
| Cuenta bloqueada | Pantalla completa, icono `ShieldAlert` · «Tu cuenta está bloqueada» · «Por seguridad pausamos tu acceso. Contacta a MAC Compresores para reactivarlo.» (+ correo/teléfono si `contact`) | solo «Cerrar sesión» |
| Error de red | `ErrorState` «No pudimos buscar en este momento.» · «Revisa tu conexión e inténtalo de nuevo.» | «Reintentar» |
| Difuminado | Panel centrado (fondo `--panel`, borde `--border`, `--elev-pop`): «Toca para mostrar precios» · `text-xs` «Ocultamos los precios cuando sales de esta pantalla.» | botón primario «Toca para mostrar precios» |
| Leyenda | «Precios sin IVA · moneda indicada por producto» (`text-xs text-muted`, siempre visible bajo los resultados y bajo el buscador vacío) | — |

## 5. Resultados: tarjetas (<768 px) y tabla (≥768 px) con una sola marcación
Una sola `<table class="table portal-table">` evita cargar dos veces cada PNG firmado (un `display:none` igual descarga y gasta tokens de 60 s). Columnas `data-col`: `sku`, `desc`, `unit`, `cur`, `price` (con `<th scope="col">` SKU, Descripción, Unidad, Moneda, Precio de socio; `price` alineado a la derecha).
```css
@media (max-width: 767px) {            /* 360 y 390 px: tarjeta, sin scroll horizontal */
  .portal-table { width: 100%; min-width: 0; }        /* anula width:max-content de .table (causa scroll) */
  .portal-table thead { display: none; }
  .portal-table tbody tr { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: .25rem .75rem; padding: .75rem 1rem; border-bottom: 1px solid var(--border); }
  .portal-table td { display: block; height: auto; max-width: none; min-width: 0; padding: 0; border: 0; position: static; }
  .portal-table td[data-col=sku]  { grid-area: 1/1; }           /* mono 13 px, 500 */
  .portal-table td[data-col=cur]  { grid-area: 1/2; justify-self: end; }
  .portal-table td[data-col=desc] { grid-column: 1/-1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .portal-table td[data-col=unit] { grid-area: 3/1; align-self: center; font-size: .75rem; color: var(--muted); }  /* «Unidad: PZA» */
  .portal-table td[data-col=price]{ grid-area: 3/2; justify-self: end; }
}
```
- ≥768 px (1280 probado): tabla estándar `.table`, contenedor `.portal-main` (máx. 1024 px), `th` 12 px, fila de 56 px (imagen 32 px + 12 px de relleno), `price` en `.num`. Sin orden por columnas (evita barridos y reordenados).
- `PriceImg`: `height:32px; width:auto`; pedir a agente 4 un PNG de lienzo fijo **144×32 CSS px (288×64 px reales, @2x)** con píldora blanca `#fff` y texto `#0f172a` (17.85:1), independiente del tema, para que el ancho no cause saltos de layout (`width`/`height` explícitos en `<img>`). `alt="Precio protegido"`.
- `CurrencyChip`: MXN = `Badge neutral` (`text-ink-soft` / `bg-panel-2`), USD = `Badge blue`. El texto «MXN»/«USD» es el canal; el color solo refuerza.
- La fila entera no es interactiva (sin enlaces ni selección), así que no requiere hit-target; los botones y el campo sí miden ≥44 px.

## 6. Admin (`(app)/socios`)
**Lista `/socios`** — `PageHeader` «Socios comerciales», subtítulo «{n} socios»; acciones: secundarios «Historial» y «Ajustes de descuento», primario «Nuevo socio». `Card` + `.toolbar` (`SearchInput` aria-label «Buscar socio», placeholder «Nombre, empresa o correo»; `<select>` Estado: Todos/Activos/Bloqueados; «Filtrar») + `DataTable mobileCards` + `Pager noun="socios"`.
| Columna | Contenido |
|---|---|
| Nombre | `Link` `font-medium text-accent-fg` a `/socios/[id]` |
| Empresa · Correo | texto; correo `text-xs text-muted` (en móvil queda como fila etiquetada) |
| Descuento (`align:"right"`) | «15 %» + chip «global» (`Badge neutral`) o «propio» (`Badge blue`); `fmtPct`, 2 decimales solo si los hay |
| Estado | `Badge green` «Activo» / `Badge red` «Bloqueado»; si falta 2FA, debajo `Badge amber` «2FA pendiente» |
| Último acceso | `fmtDateTime` o «Nunca» (`text-muted`) |
Vacío: `EmptyState` «Aún no hay socios» · «Da de alta a tu primer socio para darle acceso al portal.» · «Nuevo socio». Con filtros: `FilteredEmpty clearHref="/socios"`.

**Formulario `/socios/nuevo` y `/socios/[id]`** — `Card` «Datos del socio» con `ActionForm` (`submitLabel` «Crear socio» / «Guardar cambios»). Etiquetas visibles siempre (nunca solo placeholder). Validación **al salir del campo (blur)** con `Field error`; el error se limpia al escribir (ya lo hace `Field`).
| Campo (label) | Regla y mensaje de error | Ayuda |
|---|---|---|
| Nombre | requerido · «Escribe el nombre del socio.» | — |
| Empresa | requerido · «Escribe la empresa del socio.» | — |
| Correo electrónico | formato · «Escribe un correo válido, por ejemplo nombre@empresa.com.» | — |
| Contraseña temporal (solo nuevo) | mín. 10 caracteres (supuesto; confirmar con agente 3) · «Usa al menos 10 caracteres.» | «Compártela por un canal seguro.» |
| Descuento propio (%) | vacío o 0–60, máx. 2 decimales · «Escribe un porcentaje entre 0 y 60.» / «Usa hasta 2 decimales, por ejemplo 12.5.» | «Déjalo vacío para usar el global ({g} %).» |
| Cuota diaria de búsquedas | vacío o entero ≥1 · «Escribe un número entero mayor que 0.» | «Déjalo vacío para usar el valor global ({q}).» |
Layout: 1 columna en móvil, 2 columnas desde 768 px (`grid gap-4 md:grid-cols-2`). `PageHeader.meta` en detalle: Estado, 2FA («Activa»/«Pendiente»), Descuento efectivo («15 % · global»), Último acceso. Tarjeta «Seguridad» con las acciones; tarjeta «Actividad reciente» (10 filas) con enlace «Ver historial de {nombre}» → `/socios/historial?partnerId=`.

**Acciones destructivas** — `Dialog` centrado (hoja inferior en móvil), foco inicial en «Cancelar», pie con `.dialog-actions`, botones con `.tap`. El botón de confirmar repite el nombre de la acción y del socio (nunca «Aceptar»).
| Disparador (`btn-secondary text-danger`) | Título / cuerpo | Confirmar |
|---|---|---|
| «Bloquear acceso» | «Bloquear a {nombre}» · «No podrá iniciar sesión ni buscar precios hasta que lo desbloquees. Su sesión actual se cierra.» + campo «Motivo (opcional)» | `btn-danger` «Bloquear a {nombre}» |
| «Restablecer 2FA» | «Restablecer 2FA de {nombre}» · «Borramos su app de verificación y sus códigos de respaldo. En su próximo inicio de sesión tendrá que configurarla de nuevo.» | `btn-danger` «Restablecer 2FA de {nombre}» |
| «Desbloquear acceso» (no destructivo) | «Desbloquear a {nombre}» · «Podrá iniciar sesión de nuevo con su contraseña y su 2FA.» | `btn-primary` «Desbloquear a {nombre}» |
Toasts: «{nombre} quedó bloqueado.», «Restableciste el 2FA de {nombre}.», «{nombre} quedó desbloqueado.», «Guardaste los cambios de {nombre}.»

**Ajustes `/socios/ajustes`** — `Card` «Descuento y cuota global»: «Descuento global (%)» (15 por defecto, hint «Aplica a los socios sin descuento propio. Entre 0 y 60, hasta 2 decimales.») y «Cuota diaria de búsquedas» (80, hint «Aplica a los socios sin cuota propia.»). Resumen `text-sm`: «{k} de {n} socios usan el descuento global.» Ejemplo informativo: «Un producto de $1,000.00 se muestra a $850.00 (con 15 %)». Botón «Guardar ajustes». Éxito: «Descuento global actualizado a {x} %.» Error de servidor: «No pudimos guardar los ajustes. Inténtalo de nuevo.»

**Historial `/socios/historial`** — `.toolbar` con etiquetas visibles: «Socio» (select, «Todos los socios»), «Tipo de evento» (select agrupado por categoría, «Todos los eventos»), «Desde» y «Hasta» (`type="date"`, zona México), botones «Filtrar» y «Limpiar filtros» (`ghost`). Si `hasta < desde`: «La fecha final debe ser igual o posterior a la inicial.» `DataTable mobileCards` + `Pager noun="movimientos"`.
Columnas: Fecha y hora (`fmtDateTime`, mono, nowrap) · Socio · Evento (badge de severidad + etiqueta; prefijo `sr-only` «Crítico: ») · Detalle (resumen de `meta`, p. ej. «“válvula” · 12 resultados») · IP (mono) · Dispositivo (`text-xs text-muted`, 1 línea con truncado; completo en la tarjeta móvil). Vacío: `FilteredEmpty` «Sin movimientos con estos filtros».

## 7. Severidad y etiquetas de actividad
Severidad = tono de `Badge` + icono `lucide` (`Info`, `AlertTriangle`, `ShieldAlert`) + palabra (nunca solo color). **info** = actividad normal; **advertencia** = anomalía que solo se registra o falla recuperable; **crítico** = bloqueo o evento que bloquea al socio (webdriver, honeypot, cuota excedida, bloqueo automático, según el plan).
```ts
import type { PartnerActivityType } from "@prisma/client";
import type { Tone } from "@/components/ui/badge";

export type Severity = "info" | "warning" | "critical";
export const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  info: { label: "Información", tone: "blue" },
  warning: { label: "Advertencia", tone: "amber" },
  critical: { label: "Crítico", tone: "red" },
};
export const ACTIVITY: Record<PartnerActivityType, { label: string; severity: Severity }> = {
  LOGIN_OK: { label: "Inició sesión", severity: "info" },
  LOGIN_FAIL: { label: "Inicio de sesión fallido", severity: "warning" },
  TOTP_OK: { label: "Verificó su código 2FA", severity: "info" },
  TOTP_FAIL: { label: "Código 2FA incorrecto", severity: "warning" },
  TOTP_SETUP: { label: "Activó la verificación 2FA", severity: "info" },
  BACKUP_CODE_USED: { label: "Usó un código de respaldo", severity: "warning" },
  SEARCH: { label: "Buscó precios", severity: "info" },
  PRICE_VIEW: { label: "Vio un precio", severity: "info" },
  LOGOUT: { label: "Cerró sesión", severity: "info" },
  SESSION_REVOKED: { label: "Sesión cerrada por otro inicio", severity: "info" },
  QUOTA_EXCEEDED: { label: "Excedió su cuota diaria", severity: "critical" },
  RATE_LIMITED: { label: "Búsquedas demasiado rápidas", severity: "warning" },
  AUTO_BLOCK: { label: "Bloqueo automático", severity: "critical" },
  SWEEP_SUSPECT: { label: "Búsquedas en barrido sospechosas", severity: "warning" },
  HIDDEN: { label: "Salió de la pestaña", severity: "info" },
  PRINT_ATTEMPT: { label: "Intentó imprimir", severity: "warning" },
  COPY_ATTEMPT: { label: "Intentó copiar", severity: "warning" },
  CAPTURE_KEY: { label: "Presionó tecla de captura", severity: "warning" },
  DEVTOOLS: { label: "Abrió herramientas de desarrollo", severity: "warning" },
  WEBDRIVER: { label: "Navegador automatizado detectado", severity: "critical" },
  HONEYPOT: { label: "Entró a un enlace trampa", severity: "critical" },
  ADMIN_CHANGE: { label: "Cambio hecho por un administrador", severity: "info" },
};
```
Categorías del selector de tipo: Acceso (LOGIN_*, TOTP_*, BACKUP_CODE_USED, LOGOUT, SESSION_REVOKED), Consulta (SEARCH, PRICE_VIEW), Límites (QUOTA_EXCEEDED, RATE_LIMITED, SWEEP_SUSPECT, AUTO_BLOCK), Seguridad (HIDDEN, PRINT_ATTEMPT, COPY_ATTEMPT, CAPTURE_KEY, DEVTOOLS, WEBDRIVER, HONEYPOT), Administración (ADMIN_CHANGE).

## 8. Marca de agua (`<Watermark>`, canvas)
Canvas `position:fixed; inset:0; width:100vw; height:100dvh; pointer-events:none; z-index:30; aria-hidden`, encima de resultados y debajo del `ShieldOverlay`; no se difumina (queda nítida en una foto del difuminado). Tamaño real = CSS × `devicePixelRatio`.
- Texto, 2 líneas por mosaico: `{nombre} · ID {shortId}` y `{dd/mm/aaaa} {HH:mm} · {IP}`. Fuente `600 13px` Plex Mono (≥12 px = legible en foto de pantalla), `textAlign:center`.
- Ángulo −28° (≈ −0.489 rad). Mosaico de 260×130 px CSS, con línea alterna desplazada medio mosaico para evitar columnas vacías. Se redibuja con `resize` y cada 60 s.
- Doble pasada que funciona sobre fondo claro y oscuro (tema o foto): primero trazo oscuro `strokeStyle rgba(15,23,42,0.18)`, `lineWidth 2`; luego relleno `fillStyle rgba(255,255,255,0.12)`. Opacidad total baja a propósito: con levantar niveles/contraste (lo que haría quien investigue una foto) el texto aparece, y casi no cambia el fondo del contenido.
- Contraste del contenido bajo la marca (peor caso, texto totalmente cubierto por el halo): claro, fondo `#fff` + halo 18 % = `#d4d5d9`: `text-ink` 9.97:1, `text-muted` 5.17:1; oscuro, `#111a2b` + relleno 12 % = `#2e3644`: `text-ink` 9.86:1, `text-muted` 4.74:1. Todos ≥ 4.5:1. Por eso **no subir** estas alfas sin recalcular. Con la píldora de precio (`#fff`/`#0f172a`) el peor caso es 12.2:1.
- La marca es decorativa/de trazabilidad (WCAG 1.4.3 exime texto decorativo), aun así se mantuvo el AA del contenido.

## 9. Difuminado y bloqueo (`.shield-target`, `ShieldOverlay`)
```css
.shield-target[data-hidden="true"] { filter: blur(16px) saturate(.6); pointer-events: none; }  /* sin transition */
.shield-target { -webkit-touch-callout: none; user-select: none; }
.shield-target :where(input, textarea) { user-select: text; }       /* el buscador sigue siendo editable */
.shield-overlay { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 1rem;
  background: color-mix(in oklab, var(--bg) 55%, transparent); animation: fade var(--dur) var(--ease); }
@media print { .portal, .portal * { display: none !important; } body { background: #fff; } }
@media (prefers-reduced-motion: reduce) { .shield-overlay { animation: none; } }
```
- 16 px de desenfoque deja ilegibles los dígitos de 32 px de alto. Se aplica al instante (sin transición) en `visibilitychange`, `blur`, `pagehide` y teclas de captura; al volver, solo se quita con el toque en el botón (no al recuperar el foco).
- Panel del overlay con `--panel` sólido: «Toca para mostrar precios» (`on-accent/accent` 5.20:1 claro, 5.04:1 oscuro) y texto de apoyo `text-ink` sobre panel 14.62:1 / 14.12:1; independiente de lo que haya detrás. `role="dialog"` no modal con `aria-live="polite"`; el botón recibe el foco al aparecer.
- Recomendación para agente 6/4: además del filtro, sustituir `src` de las `<img>` por un pixel transparente mientras `data-hidden` (borrar el filtro en devtools no revela el precio).
- `/login` y `/2fa` quedan fuera de `shield-target` y de la marca de agua: el socio debe poder copiar/descargar sus códigos de respaldo (se muestran una sola vez, `no-store`).

## 10. Contraste AA (razón calculada a mano con la fórmula WCAG; tokens de `globals.css`)
| Par texto / fondo | Claro | Oscuro |
|---|---|---|
| `text` / `panel` | 14.62 | 14.12 |
| `text-2` / `panel` | 10.35 | 11.72 |
| `muted` / `panel` (placeholder, ayudas) | 7.58 | 6.78 |
| `muted` / `bg` (leyenda) | 6.91 | 7.30 |
| `muted` / `panel-2` | 7.18 | 6.21 |
| `text-2` / `panel-2` (chip MXN) | 9.82 | 10.74 |
| `accent-fg` / `accent-soft` (chip USD, badge info) | 5.76 | 6.86 |
| `accent-fg` / `panel` (enlaces) | 6.57 | 7.71 |
| `ok` / `ok-soft` (Activo) | 5.80 | 6.91 |
| `warn` / `warn-soft` (advertencia, 2FA pendiente) | 5.65 | 8.14 |
| `danger` / `danger-soft` (crítico, Bloqueado) | 5.75 | 6.85 |
| `danger` / `panel` (errores de campo) | 6.57 | 7.63 |
| `on-accent` / `accent` (botón primario) | 5.20 | 5.04 |
| `.btn-danger` (`#fff`/`danger`; `#1a0a0a`/`danger`) | 6.57 | 8.43 |
| Precio PNG `#0f172a` / `#fff` | 17.85 | 17.85 |
| QR `#000` / `#fff` | 21.00 | 21.00 |
Bordes de campo `--border-input` ≥ 3:1 (ya verificado en el sistema). Foco: `:focus-visible` 2 px `--accent-fg` con offset 2 px (global). Los pares con la marca de agua encima están en §8.
