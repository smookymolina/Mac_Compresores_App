# Sistema de diseño

Solo capa visual: ninguna regla de negocio, acción, permiso ni ruta cambia. Fuente de verdad de los tokens: `src/app/globals.css`.

## Tokens
- **Superficies/texto:** `bg` (fondo app), `panel`, `panel-2` (cabeceras, hover), `border`, `border-strong`, `text`, `text-2`, `muted`. Clases Tailwind: `bg-surface`, `bg-panel`, `bg-panel-2`, `border-line`, `text-ink`, `text-ink-soft`, `text-muted`.
- **Acento:** azul de marca `#046bd2` (`bg-brand`, `text-accent-fg` para enlaces, `bg-accent-soft`). Un solo acento.
- **Semánticos:** `ok`, `warn`, `danger` (+ `-soft`). Info = acento. Contraste ≥ 4.5:1 texto/fondo en ambos temas.
- **Tema:** claro/oscuro con `light-dark()`; sigue `prefers-color-scheme` y se puede forzar con `data-theme` (botón en la topbar, guardado en `localStorage`).
- **Radios:** 4 / 6 / 8 px. **Sombras:** solo `--elev-1` (tarjetas) y `--elev-pop` (menús, toasts). **Espaciado:** base 4 px (`--space-1…8`, utilidades Tailwind).
- **Movimiento:** `--dur-fast` 150 ms, `--dur` 200 ms, `--ease`. Solo `opacity`/`transform`; `prefers-reduced-motion` los reduce a ~0.

## Tipografía
Inter (UI) y JetBrains Mono (SKU, folios, códigos: clase `.mono`), ambas con `next/font`. Cifras con `tabular-nums` (`.num` en tablas, KPIs). Escala: 12 (meta/cabeceras), 13 (tablas), 14 (cuerpo), 20–24 (título de vista), 24 (KPI).

## Densidad
Filas de tabla 40–44 px, cabecera 36 px, controles 36 px (40 px en pantallas táctiles), tarjetas con padding 16 px. Una acción primaria por vista (`PageHeader.actions`).

## Componentes (`src/components/ui`, `src/components/shell`)
| Componente | Notas |
|---|---|
| `AppShell` | Sidebar: ≥1280 px expandido y colapsable; 768–1279 px solo iconos; <768 px drawer (`Dialog`). Topbar con breadcrumb, tema y menú de usuario |
| `Button`/`LinkButton`/`btnClass` | `primary`, `secondary`, `danger`, `ghost`; `size="sm"` |
| `Field`/`SelectField`, `.input`, `.label` | `label` ligado por `id`, `aria-invalid` + `aria-describedby` en error |
| `Badge` | Color + punto + texto (nunca solo color) |
| `Card`, `CardHeader`, `PageHeader`, `Stat` (KPI) | En móvil las acciones de `PageHeader` pasan a barra inferior fija |
| `DataTable` | Cabecera fija, orden por columna sobre las filas cargadas (`aria-sort`), estados vacío/carga/error. Móvil: scroll horizontal controlado con primera columna fija |
| `EmptyState`, `ErrorState`, `Skeleton`, `TableSkeleton` | Skeletons en lugar de spinners (`loading.tsx`) |
| `Dialog` | `<dialog>` nativo: modal / drawer (`side`), foco atrapado, Esc, `aria-labelledby` |
| `ToastProvider`/`useToast` | Éxitos de `ActionForm`; región `aria-live="polite"`. Los errores siguen en línea (`role="status"`) |

## Reglas de uso
- Páginas solo componen UI; datos y permisos siguen en `service.ts`/`actions.ts`.
- Iconos solo `lucide-react`, `strokeWidth` 1.75. Sin gradientes, glassmorphism ni emojis.
- Animaciones: no animar `width/top/box-shadow`; no usar `transform` en ancestros de elementos `position: fixed`.
- Los `name`/`id` de campos y los textos de etiquetas no se cambian (los usan los e2e).
