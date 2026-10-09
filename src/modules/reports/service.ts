import "server-only";
import { db } from "@/lib/db";
import { dec } from "@/lib/money";
import { assertCan, type CurrentUser } from "@/lib/auth/session";
import { toCsv, type CsvCell } from "@/lib/csv";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";
import { LINE_LABEL } from "@/modules/products/lines";
import { METHOD_LABEL, dueDate, paidOf } from "@/modules/payments/service";

export const REPORTS = {
  ventas: { title: "Ventas", description: "Ventas del periodo con importes, pagado y saldo.", dated: true },
  cotizaciones: { title: "Cotizaciones", description: "Cotizaciones creadas en el periodo y su estado.", dated: true },
  pagos: { title: "Pagos recibidos", description: "Cobranza registrada en el periodo (incluye anulados).", dated: true },
  comisiones: { title: "Comisiones", description: "Comisiones de los periodos que se cruzan con las fechas.", dated: true },
  inventario: { title: "Existencias", description: "Existencia y mínimo por producto y almacén (al momento).", dated: false },
  catalogo: { title: "Catálogo de productos", description: "Productos activos con costo, precio y línea.", dated: false },
} as const;
export type ReportKind = keyof typeof REPORTS;

const day = (d: Date) => d.toISOString().slice(0, 10);
const money = (v: { toFixed(n: number): string } | null | undefined) => (v ? v.toFixed(2) : "0.00");

/** Genera el CSV de un reporte. Rango [desde, hasta] inclusivo (fechas en UTC, como se guardan). */
export async function buildReport(user: CurrentUser, kind: ReportKind, from: Date, to: Date): Promise<{ filename: string; csv: string }> {
  assertCan(user, "reports.export");
  const until = new Date(to.getTime() + 864e5); // fin del día «hasta»
  const range = `${day(from)}_a_${day(to)}`;
  let headers: string[];
  let rows: CsvCell[][];

  switch (kind) {
    case "ventas": {
      const sales = await db.sale.findMany({
        where: { confirmedAt: { gte: from, lt: until } },
        include: { customer: { select: { legalName: true, rfc: true, paymentTermsDays: true } }, seller: { select: { name: true } }, quote: { select: { folio: true } }, payments: { select: { amount: true, voidedAt: true } } },
        orderBy: { confirmedAt: "asc" },
      });
      headers = ["Venta", "Cotización", "Fecha", "Cliente", "RFC", "Vendedor", "Estado", "Subtotal", "Descuento", "IVA", "Total", "Pagado", "Saldo", "Vence"];
      rows = sales.map((s) => {
        const paid = s.status === "CONFIRMED" ? paidOf(s.payments) : dec(0);
        return [`V-${s.folio}`, `C-${s.quote.folio}`, day(s.confirmedAt), s.customer.legalName, s.customer.rfc, s.seller.name,
          s.status === "CONFIRMED" ? "Confirmada" : "Cancelada", money(s.subtotal), money(s.discountTotal), money(s.taxTotal), money(s.total),
          money(paid), money(s.status === "CONFIRMED" ? s.total.sub(paid) : dec(0)), day(dueDate(s.confirmedAt, s.customer.paymentTermsDays))];
      });
      break;
    }
    case "cotizaciones": {
      const quotes = await db.quote.findMany({
        where: { createdAt: { gte: from, lt: until } },
        include: { customer: { select: { legalName: true } }, seller: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      });
      headers = ["Cotización", "Fecha", "Cliente", "Vendedor", "Estado", "Vigencia", "Subtotal", "Descuento", "IVA", "Total"];
      rows = quotes.map((q) => [`C-${q.folio}`, day(q.createdAt), q.customer.legalName, q.seller.name, QUOTE_STATUS_LABEL[q.status],
        day(q.validUntil), money(q.subtotal), money(q.discountTotal), money(q.taxTotal), money(q.total)]);
      break;
    }
    case "pagos": {
      const payments = await db.payment.findMany({
        where: { paidAt: { gte: from, lt: until } },
        include: { sale: { select: { folio: true, customer: { select: { legalName: true } } } }, createdBy: { select: { name: true } } },
        orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
      });
      headers = ["Fecha", "Venta", "Cliente", "Forma", "Referencia", "Importe", "Registró", "Anulado", "Motivo de anulación"];
      rows = payments.map((p) => [day(p.paidAt), `V-${p.sale.folio}`, p.sale.customer.legalName, METHOD_LABEL[p.method], p.reference,
        money(p.amount), p.createdBy.name, p.voidedAt ? "Sí" : "No", p.voidReason]);
      break;
    }
    case "comisiones": {
      const entries = await db.commissionEntry.findMany({
        where: { period: { startDate: { lt: until }, endDate: { gte: from } } },
        include: { period: { select: { name: true } }, seller: { select: { name: true } } },
        orderBy: [{ period: { startDate: "asc" } }, { seller: { name: "asc" } }, { line: "asc" }],
      });
      headers = ["Periodo", "Vendedor", "Línea", "Base", "Venta total del vendedor", "Meta", "Meta cumplida", "Tasa", "Comisión", "Estado"];
      const STATUS = { CALCULATED: "Calculada", APPROVED: "Aprobada", PAID: "Pagada" } as const;
      rows = entries.map((e) => [e.period.name, e.seller.name, LINE_LABEL[e.line], money(e.baseAmount), money(e.sellerTotal), money(e.targetAmount),
        e.metTarget ? "Sí" : "No", e.rate.toString(), money(e.amount), STATUS[e.status]]);
      break;
    }
    case "inventario": {
      const balances = await db.stockBalance.findMany({
        include: { product: { select: { sku: true, description: true, unit: true } }, warehouse: { select: { name: true } } },
        orderBy: [{ product: { sku: "asc" } }],
      });
      headers = ["SKU", "Descripción", "Almacén", "Existencia", "Unidad", "Mínimo", "Bajo mínimo"];
      rows = balances.map((b) => [b.product.sku, b.product.description, b.warehouse.name, b.quantity.toString(), b.product.unit,
        b.minStock.toString(), b.minStock.gt(0) && b.quantity.lte(b.minStock) ? "Sí" : "No"]);
      break;
    }
    case "catalogo": {
      const products = await db.product.findMany({
        where: { status: "ACTIVE" },
        select: { sku: true, oemName: true, oemPartNumber: true, description: true, line: true, unit: true, cost: true, price: true, taxRate: true, category: { select: { name: true } } },
        orderBy: { sku: "asc" },
      });
      headers = ["SKU", "OEM", "No. de parte", "Descripción", "Categoría", "Línea", "Unidad", "Costo", "Precio", "IVA"];
      rows = products.map((p) => [p.sku, p.oemName, p.oemPartNumber, p.description, p.category?.name, LINE_LABEL[p.line], p.unit,
        p.cost.toFixed(4), money(p.price), p.taxRate.toString()]);
      break;
    }
  }
  const filename = REPORTS[kind].dated ? `${kind}_${range}.csv` : `${kind}_${day(new Date())}.csv`;
  return { filename, csv: toCsv(headers, rows) };
}
