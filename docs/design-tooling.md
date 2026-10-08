# Herramientas de diseño (rediseño frontend)

Registro de la fase 0: plugins y skills buscados en el marketplace de la cuenta con
`SearchPlugins` / `SearchSkills` (2026-10-08).

**Inventario inicial:** `ListPlugins` → vacío. `ListSkills` → solo skills genéricas de documentos/archivos
(docs, pdf, xlsx, pptx, canvas-design, web-artifacts-builder, etc.); ninguna de diseño de interfaces ni a11y.
**Búsquedas** (5 grupos × plugins y skills): las de skills no devolvieron resultados; todo lo relevante está en plugins.

## Selección (4 de máx. 5)

| Nombre | Origen | Uso previsto en el rediseño | Estado |
|---|---|---|---|
| `frontend-design` | Anthropic Directory (publisher `anthropics`) | Criterio de diseño de UI/UX al implementar componentes | Tarjeta de instalación emitida; **no activo al verificar** (`ListPlugins` vacío) |
| `VectorLab UI/UX Skills` | Anthropic Directory (comunidad, alcance *contained*) | `anti-slop`, `empty-states`, `forms`, `motion`, `reduced-motion`, `viewports`, `ux-audit` | Tarjeta emitida; **no activo al verificar** |
| `audit-suite` | Anthropic Directory (comunidad, *contained*) | `audit-as-a11y-eng`, `audit-as-perf-eng`, `web-animation-design`, `web-design-guidelines` | Tarjeta emitida; **no activo al verificar** |
| `A11y Enforcer` | Anthropic Directory (comunidad, *contained*) | WCAG 2.2 en React: labels, foco, teclado, contraste | Tarjeta emitida; **no activo al verificar** |

**Por qué no se activaron:** `SuggestPluginInstall` solo renderiza una tarjeta; la habilitación del plugin la hace
el usuario fuera de banda, así que tras la llamada `ListPlugins` siguió vacío. Según la regla de la fase 0
("si alguno falla, continúa sin él y anótalo"), el rediseño se hizo **sin** estos plugins. Para usarlos en una
sesión posterior basta habilitarlos desde la tarjeta / el marketplace; no se requiere ningún cambio en el repo.

## Verificación de la fase 0 del segundo pase (2026-10-08)

Requisito: `frontend-design`, `VectorLab UI/UX Skills`, `audit-suite` y `A11y Enforcer` activos antes de tocar código.

- `ListPlugins` (sin filtro y con `data`/`frontend`) → **vacío**.
- `ListSkills` (filtros `frontend-design`, `vectorlab`, `audit`, `a11y`, `ux`, `design`) → solo `mcp-builder`,
  `canvas-design` y `brand-guidelines`; ninguna de las skills requeridas (`ux-audit`, `anti-slop`, `viewports`,
  `audit-as-*`, `a11y-check`, `contrast`, etc.).
- Los plugins sí figuran en Ajustes → Plugins de claude.ai ("Yours"), pero no llegan a las sesiones de Claude Code
  en la nube. Para cargarlos aquí hay que declararlos en `.claude/settings.json` (`extraKnownMarketplaces` +
  `enabledPlugins`) o habilitarlos de forma que `ListPlugins` los devuelva.

**Resultado: fase 0 no superada. Fases 1–7 detenidas** hasta que los 4 plugins estén activos en la sesión.

## Descartados (y motivo)

| Candidato | Motivo |
|---|---|
| `design` (Knowledge Work) | Trae 8 conectores MCP (Slack, Gmail, Asana…) innecesarios para código; su valor se cubre con `frontend-design` + `VectorLab` |
| `dataink` | Alcance *privileged* con hook `PostToolUse`; no se instala código con hooks sin revisión |
| `playwright` (MCP, Microsoft) | Playwright ya es dependencia del repo (`@playwright/test`); se usa `scripts/screenshots.mjs` |
| `Snagly`, `preset-toolkit`, `doom-design-system`, `Skills for React/React Native` | *privileged*, o de otro stack/producto |
| Flutter, Shopify/Liquid, Mobile Design System, Remotion, Motion Reel, animation-studio, ScreenshotOne, App Store screenshots | Otro stack, vídeo o marketing |

## Herramientas propias del repo usadas

| Herramienta | Uso |
|---|---|
| `scripts/screenshots.mjs` | Capturas Playwright a 375 / 768 / 1440 px de login, dashboard, listas, formularios y drawer + comprobación de scroll horizontal |
| Chromium preinstalado (`CHROMIUM_PATH=/opt/pw-browsers/chromium`) | Motor de las capturas |
| `lucide-react` (ya instalado) | Única familia de iconos, `strokeWidth` 1.75 |
