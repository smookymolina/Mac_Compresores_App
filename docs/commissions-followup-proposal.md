# Propuesta: comisiones y seguimiento comercial (v1.3.21, NO implementada)

> Estado: **solo propuesta**. Requiere decisión del negocio antes de tocar código o datos de producción.

## Cómo funciona hoy
- Las comisiones se calculan por **venta confirmada** (O.C., neto sin IVA) con la regla activa (`CommissionRuleSet`): una tasa por línea de producto, `rateMet` si el vendedor cumplió su meta del periodo y `rateNotMet` si no.
- El trabajo diario recalcula los periodos abiertos sin entradas aprobadas.
- El seguimiento de cotizaciones (v1.3.21: avisos, cancelación de borradores, motivo de pérdida) **no afecta** a las comisiones.

## Opciones para vincular el seguimiento con las comisiones
| # | Propuesta | Efecto | Riesgo |
|---|---|---|---|
| A | No cambiar nada (recomendada por ahora) | Las comisiones siguen dependiendo solo de ventas confirmadas | Ninguno |
| B | Bono o tasa extra por conversión: % de cotizaciones enviadas que terminan en venta en el periodo | Premia el seguimiento | Incentiva no registrar cotizaciones dudosas; hay que excluir canceladas `DUPLICATE` |
| C | Penalización por pérdidas sin motivo validado o borradores abandonados | Mejora la disciplina de captura | Puede sentirse punitiva; depende de que los administradores validen a tiempo |
| D | Indicador informativo en el reporte de comisiones (tasa de conversión, pérdidas por motivo) sin afectar el pago | Visibilidad sin cambiar dinero | Bajo |

## Decisiones que necesita el negocio
1. ¿Se elige A, B, C o D (o una combinación, p. ej. D ahora y B más adelante)?
2. Si es B o C: fórmula exacta, tope, a partir de qué periodo aplica y si es retroactiva (recomendación: **no retroactiva**, nueva versión de `CommissionRuleSet`).
3. ¿Qué motivos de pérdida cuentan o no (p. ej. `DUPLICATE` y `ABANDONED`)?
4. ¿Quién aprueba el cambio y cómo se comunica a los vendedores?

## Implementación sugerida (cuando se decida)
- Nueva versión de la regla (las activas nunca se editan), con campos opcionales para el bono o la penalización.
- Cálculo en `modules/commissions/service.ts` con `Prisma.Decimal`, pruebas de integración y revisión de un modelo de razonamiento alto antes de producción.
