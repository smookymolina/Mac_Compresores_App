# Sistema de diseño

Solo capa visual: ninguna regla de negocio, acción, permiso ni ruta cambia. Fuente de verdad de los tokens: `src/app/globals.css`.

## Tokens
- **Superficies/texto:** `bg` (fondo app), `panel`, `panel-2` (cabeceras, hover), `border`, `border-strong`, `text`, `text-2`, `muted`. Clases Tailwind: `bg-surface`, `bg-panel`, `bg-panel-2`, `border-line`, `text-ink`, `text-ink-soft`, `text-muted`.
- **Acento:** azul de marca `#046bd2` (`bg-brand`, `text-accent-fg` para enlaces, `bg-accent-soft`). Un solo acento.
- **Semánticos:** `ok`, `warn`, `danger`, `info` (+ `-soft`; `info` = acento). Contraste ≥ 4.5:1 texto/fondo en ambos temas (mín. 4.72:1, verificado con A11y Enforcer `contrast.py`); bordes de campo `--border-input` ≥ 3:1 (WCAG 1.4.11).
- **Tema:** claro/oscuro con `light-dark()`; sigue `prefers-color-scheme` y se puede forzar con `data-theme` (botón en la topbar, guardado en `localStorage`).
- **Identidad:** paleta de maccompresores.com.mx (tema Astra): azul `#046bd2`/`#045cb4`, pizarra `#1e293b`/`#334155`, fondo `#F0F5FA`, bordes `#D1D5DB`; barra lateral grafito en ambos temas (`.sidebar` reasigna los tokens en su ámbito); radios contenidos.
- **Radios:** 3 / 4 / 6 px (control < panel). **Elevación:** borde 1 px primero; `--elev-1` (tarjetas) y `--elev-pop` (menús, toasts) con alfa < 0.08 en claro; en oscuro, luz de borde superior (`inset`) en lugar de sombra. **Espaciado:** base 4 px (`--space-1…8`, utilidades Tailwind).
- **Login:** único momento orquestado: manómetro SVG (`login/gauge.tsx`) cuya aguja barre una vez (1.1 s, excepción documentada; solo `transform`) + entrada escalonada del contenido ≤ 300 ms. Con movimiento reducido aparece en su estado final.
- **Movimiento:** solo tokens `--dur-fast` 150 ms y `--dur` 200 ms; `--ease` (salida suave) para entradas, `--ease-in` para salidas. Solo `opacity`/`transform`. Escalonado 25 ms/elemento, ≤ 300 ms en total. Con `prefers-reduced-motion`: cambios instantáneos, sin escala de pulsación, sin pulso de skeleton.

## Tipografía
IBM Plex Sans (UI) e IBM Plex Mono (SKU, folios y cifras de KPI: `.mono`, `.kpi-value`), ambas con `next/font` y solo pesos 400/500/600. Elegidas por su herencia industrial/ingeniería, acorde con el giro (compresores). Cifras con `tabular-nums` (`.num` en tablas, KPIs). Escala: 12 (solo meta: cabeceras de tabla, ayudas, fechas), 14 (tablas, etiquetas, cuerpo), 20–24 (título de vista y KPI). Pesos 400/500/600 (`<b>` = 600). Interlineado 1.5 cuerpo, 1.25 títulos (`text-wrap: balance`). Sin mayúsculas sostenidas en etiquetas.

## Densidad
Filas de tabla 40–44 px, cabecera 36 px, controles 36 px (44 px con `pointer: coarse`, token `--hit`), tarjetas con padding 16 px. Una acción primaria por vista (`PageHeader.actions`).

## Componentes (`src/components/ui`, `src/components/shell`)
| Componente | Notas |
|---|---|
| `AppShell` | Sidebar: ≥1280 px expandido y colapsable; 768–1279 px solo iconos; <768 px drawer (`Dialog`). Topbar con breadcrumb, tema y menú de usuario |
| `Button`/`LinkButton`/`btnClass` | `primary`, `secondary`, `danger`, `ghost`; `size="sm"` |
| `Field`/`SelectField`, `.input`, `.label` | `label` ligado por `id`, `aria-invalid` + `aria-describedby` en error |
| `Pager` | Pie de tabla: total, página y Anterior/Siguiente con estado en la URL (productos, clientes, cotizaciones, ventas) |
| `Badge` | Color + punto + texto (nunca solo color) |
| `Card`, `CardHeader` | Panel plano: borde 1 px, sin sombra |
| `PageHeader` | Banda de documento a todo el ancho (`.page-head`, `.app-main` recorta en x) con `meta` clave-valor (estado, cliente, vendedor…) en lugar de cadenas con «·». En móvil las acciones pasan a barra inferior fija |
| `StatGroup` + `Stat` | Franja de indicadores segmentada (no tarjetas sueltas); cifra en Plex Mono |
| `DataTable` | Cabecera fija, orden por columna sobre las filas cargadas (`aria-sort`; icono inactivo visible solo al pasar/enfocar), fila de totales `foot`, estados vacío/carga/error. También para tablas de detalle (partidas, historiales, movimientos). Móvil: scroll horizontal controlado con primera columna fija |
| `EmptyState`, `FilteredEmpty`, `ErrorState`, `Skeleton`, `TableSkeleton` | Vacío = título + frase de valor + acción; `FilteredEmpty` ofrece «Limpiar filtros». |
| `SearchInput` | Búsqueda de barra de filtros con lupa funcional |
| Botón de icono (`.icon-btn` + `data-tip`) | Cuadrado, `aria-label` + tooltip CSS en hover/foco (no `title`) |
| | Skeletons en lugar de spinners (`loading.tsx`) |
| `Dialog` | `<dialog>` nativo: modal / drawer (`side`), foco atrapado, Esc, `aria-labelledby` |
| `ToastProvider`/`useToast` | Éxitos de `ActionForm`; región `aria-live="polite"`. Los errores siguen en línea (`role="status"`) |

## Reglas de uso
- Páginas solo componen UI; datos y permisos siguen en `service.ts`/`actions.ts`.
- Iconos solo `lucide-react`, `strokeWidth` 1.75. Sin gradientes, glassmorphism ni emojis.
- Animaciones: no animar `width/top/box-shadow`; no usar `transform` en ancestros de elementos `position: fixed`.
- Un Server Component no puede pasar funciones a `ActionForm` (cliente): los errores por campo llegan a `Field`/`SelectField` por `FormErrorsContext`, sin props `error`.
- Los `name`/`id` de campos y los textos de etiquetas no se cambian (los usan los e2e).
