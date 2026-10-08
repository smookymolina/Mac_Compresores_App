# CLAUDE.md — reglas esenciales

- Lee primero `docs/architecture.md` (decisiones) y `docs/implementation-plan.md` (estado/tareas).
- Monolito modular: `src/modules/<dominio>/{service,actions,…}.ts`. Páginas en `src/app/(app)` solo componen UI.
  - `service.ts`: lógica de negocio + Prisma + autorización por objeto (scopes). Sin dependencias de React.
  - `actions.ts` ("use server"): Zod → `requirePermission` → servicio → `revalidatePath`. Envolver con `runAction`.
- Dinero: `Prisma.Decimal` y helpers de `src/lib/money.ts`. Nunca `number` en cálculos; `Number()` solo para presentación.
- Precios de cotización se calculan en servidor desde el catálogo (`modules/quotes/pricing.ts`); partidas = instantánea.
- Inventario: movimientos inmutables; correcciones con `REVERSAL`; salidas con UPDATE condicionado (`applyMovement`).
- Operaciones críticas en `db.$transaction` con guardas de estado (`updateMany where status=…`) + auditoría (`audit()`).
- Permisos: `src/lib/auth/permissions.ts` (fuente para el seed). Toda acción/página valida en servidor.
- Nada de secretos en el repo. Datos ficticios solo en seed `SEED_DEMO=1` con prefijo `[DEMO]`.
- Antes de terminar: `npm run lint && npm run typecheck && npm test && npm run build`.
- Migraciones: `npm run db:migrate -- --name <cambio>`; nunca editar migraciones aplicadas.
