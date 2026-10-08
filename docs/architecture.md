# Arquitectura

## Decisiones
| Tema | Decisión | Motivo |
|---|---|---|
| Estilo | Monolito modular Next.js 15 App Router | Bajo costo operativo; un despliegue |
| Datos | PostgreSQL 16 + Prisma 6, migraciones versionadas en `prisma/migrations` | Relacional, transacciones, `Decimal` exacto |
| Auth | Sesiones propias en BD: token aleatorio en cookie httpOnly, solo el SHA-256 se guarda; bcrypt (12) | Un solo mecanismo, sin proveedores externos; revocables |
| Autorización | RBAC en BD (`Role`/`Permission`/`RolePermission`) + scopes por objeto en servicios | Ventas solo ve sus cotizaciones/ventas y clientes propios o sin asignar |
| Validación | Zod en server actions y route handlers; decimales viajan como string | Sin `float` en el transporte |
| UI | Tailwind 4 + primitivas estilo shadcn en `src/components/ui` | Sin runtime extra |
| PDF | `pdf-lib` (fuentes estándar) en `/api/cotizaciones/[id]/pdf` | Puro JS, sin navegador headless |
| CSV | `papaparse`; route handler (CSV grande) y CLI `scripts/import-products.ts` | Lista real ~36 mil filas |

## Identidad visual
Tomada de maccompresores.com.mx (verificado): logo en `public/brand/`, azul `#046bd2`/`#045cb4`, pizarra `#1e293b`, fondo `#F0F5FA`, tipografía Roboto.

## Roles
ADMIN (todo) · GERENCIA (todo excepto usuarios; aprueba comisiones, precios especiales, cancela ventas) ·
VENTAS (clientes propios, sus cotizaciones/ventas/comisiones, descuento ≤ 15 %) · ALMACÉN (inventario, consulta de ventas).

## Reglas de negocio implementadas
- **Cotización**: precio/costo/IVA del catálogo en servidor; precio especial y descuento > 15 % requieren `quotes.override_price`; partidas guardan instantánea. Solo `DRAFT` es editable (bloqueo optimista por `updatedAt`). Transiciones en `modules/quotes/status.ts`; no se acepta vencida. No mueve inventario.
- **Venta**: solo desde cotización `ACCEPTED`; una transacción marca `CONVERTED` (UPDATE condicionado), copia partidas y descuenta inventario; `Sale.quoteId` único evita duplicados. Cancelación repone con reversas y se bloquea si el periodo tiene comisiones aprobadas.
- **Inventario**: `InventoryMovement` inmutable; `StockBalance` materializado en la misma transacción; salidas con `quantity >= q` (sin negativos bajo concurrencia); `reversesId` único (una reversa por movimiento). Servicios no manejan stock.
- **Lista de precios**: precio = costo × (1 + utilidad) + envío (igual que el Excel). `Type` → línea comercial (REFACCIONES, KIT’S→KITS, VENTA→EQUIPO_VENTA, TUBERIA, SERVICIOS, RENTA, OTROS→VALVULAS_OTROS). Cambios de precio/costo → `PriceHistory`.
- **Comisiones**: `CommissionRuleSet` versionado con tasa *meta cumplida* (verde) y *no cumplida* (rojo) por línea, sembrado desde la tabla de MAC en **BORRADOR**. Activar exige confirmación explícita. Cálculo por periodo (hora CDMX) sobre ventas confirmadas; cada `CommissionEntry` guarda regla, tasa, base, meta y resultado. Flujo `CALCULATED → APPROVED → PAID`; no se recalcula tras aprobar.
- **Auditoría**: `AuditLog` en login, catálogo, clientes, cotizaciones, ventas, inventario, comisiones y usuarios.

## Supuestos pendientes de confirmar (bloquean activar comisiones)
1. Base de cálculo: venta neta sin IVA (default), margen, o cobranza (requiere módulo de cobranza).
2. La meta se evalúa sobre el **total** del vendedor en el periodo (no por línea) y aplica la tasa a todas sus líneas (no progresivo).
3. Monto de metas por vendedor y periodicidad (se capturan en la app).
4. Descuento máximo sin autorización: 15 % (`MAX_DISCOUNT_WITHOUT_OVERRIDE`).
5. IVA por defecto 16 %; productos con precio 0 no se cotizan sin precio especial autorizado.

## Fuera de alcance (extensible)
Mantenimiento, CFDI, contabilidad, nómina, integraciones. Puntos de extensión: `Sale` (facturación/cobranza), `CommissionBasis.COLLECTED`, `MovementType`.
