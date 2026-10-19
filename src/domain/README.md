# src/domain — reglas de negocio puras

Lógica de negocio sin dependencias de servidor, compartible con la futura app móvil
(Capacitor/React): dinero (`money.ts`), precios (`pricing.ts`), estados de cotización
(`quote-status.ts`), presentación por moneda (`currency.ts`), complementos (`complements.ts`),
errores (`errors.ts`) y tipos espejo de los enums de Prisma (`types.ts`).

Regla de pureza:
- Prohibido importar `@prisma/client`, `server-only`, `node:*`, `next/*`, `@/lib/db`
  o cualquier cosa fuera de `src/domain`. Única dependencia externa: `decimal.js`.
- Dentro de `src/domain` solo imports relativos (`./money`).
- `types.ts` debe coincidir exactamente con los enums de `prisma/schema.prisma`.
- Los módulos originales (`src/lib/money.ts`, `src/modules/quotes/pricing.ts`, …) solo re-exportan.
