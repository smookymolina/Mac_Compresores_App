import { MemoryStore } from "../src/core/store";
import { CustomerService } from "../src/core/customers";
import { SalesService, type LocalSale } from "../src/core/sales";
import { InventoryService } from "../src/core/inventory";
import type { LocalServiceOptions } from "../src/core/local";
import type { LocalQuote } from "../src/core/quotes";
import { uuid } from "./helpers";

/** Datos base para clientes/ventas/inventario (pruebas de campo y contrato). */
export const P1 = uuid(1), P2 = uuid(2), C1 = uuid(10), U1 = uuid(20), W1 = uuid(50), Q1 = uuid(60), S1 = uuid(70);
export const NOW = Date.parse("2026-10-19T12:00:00Z");
export const ALL = ["customers.write", "sales.create", "payments.write", "inventory.write"];

export async function fieldSetup(permissions: string[] = ALL) {
  const store = new MemoryStore();
  await store.init();
  await store.setMeta("user", { id: U1, name: "Juan Pérez", email: "j@x.mx", role: "VENTAS", roleName: "Ventas", permissions });
  await store.setMeta("cursor", "50");
  await store.setMeta("lastSyncAt", "2026-10-18T12:00:00.000Z");
  await store.put("Product", [
    { id: P1, sku: "ABC-1", description: "Filtro", line: "REFACCIONES", kind: "PRODUCT", unit: "PZA", price: "1200.00", status: "ACTIVE" },
    { id: P2, sku: "SRV-1", description: "Servicio", line: "SERVICIOS", kind: "SERVICE", unit: "SERV", price: "500.00", status: "ACTIVE" },
  ]);
  await store.put("Warehouse", [{ id: W1, code: "MTY", name: "Monterrey", active: true }]);
  await store.put("StockBalance", [{ id: `${P1}:${W1}`, productId: P1, warehouseId: W1, quantity: "3.000", minStock: "0" }]);
  await store.put("Customer", [{
    id: C1, legalName: "Cliente Demo SA", rfc: "XAXX010101000", email: "a@b.mx", phone: null, paymentTermsDays: 30, creditLimit: "50000.00",
    notes: null, ownerId: U1, active: true, contacts: [], addresses: [], updatedAt: "2026-10-01T00:00:00.000Z",
  }]);
  const item = (id: string, productId: string, kind: string, sku: string, quantity: string, total: string) => ({
    id, productId, position: 0, sku, description: sku, details: null, line: "REFACCIONES", kind, unit: "PZA", quantity, unitPrice: "1000.00",
    origCurrency: "MXN", origUnitPrice: "1000.0000", fxRate: "1.0000", discountPct: "0.0000", taxRate: "0.1600", subtotal: total, discount: "0.00", tax: "0.00", total,
  });
  await store.put("Quote", [{
    id: Q1, folio: 1001, customerId: C1, customerName: "Cliente Demo SA", sellerId: U1, sellerName: "Juan Pérez", status: "ACCEPTED",
    validUntil: "2026-11-01T12:00:00.000Z", currency: "MXN", exchangeRate: null, notes: null, deliveryTime: null, complements: null, warrantyMonths: null,
    subtotal: "5000.00", discountTotal: "0.00", taxTotal: "800.00", total: "5800.00", createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z",
    origin: "WEB", items: [item(uuid(61), P1, "PRODUCT", "ABC-1", "5", "5000.00"), { ...item(uuid(62), P2, "SERVICE", "SRV-1", "1", "0.00"), unitCost: "1" }],
  } satisfies LocalQuote]);
  let n = 100;
  const o: LocalServiceOptions = { store, now: () => NOW, uuid: () => uuid(n++) };
  return { store, customers: new CustomerService(o), sales: new SalesService(o), inventory: new InventoryService(o) };
}

export const confirmedSale = (payments: LocalSale["payments"] = []): LocalSale => ({
  id: S1, folio: 77, quoteId: uuid(63), quoteFolio: 999, customerId: C1, customerName: "Cliente Demo SA", sellerId: U1, warehouseId: W1, status: "CONFIRMED",
  subtotal: "1000.00", discountTotal: "0.00", taxTotal: "160.00", total: "1160.00", confirmedAt: "2026-10-01T00:00:00.000Z", items: [], payments,
});

