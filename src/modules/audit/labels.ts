import type { QuoteStatus } from "@prisma/client";
import { fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";

/** Nombres claros para el administrador; las claves técnicas quedan solo como respaldo. */
export const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Inicio de sesión",
  "auth.login_failed": "Intento de acceso fallido",
  "auth.invitation_accepted": "Invitación aceptada",
  "auth.password_reset": "Contraseña restablecida",
  "auth.reset_requested": "Solicitud de recuperación de contraseña",
  "auth.reset_requested_unknown": "Recuperación solicitada con correo no registrado",
  "user.create": "Usuario creado",
  "user.update": "Usuario modificado",
  "user.delete": "Usuario eliminado",
  "user.invite_resent": "Invitación reenviada",
  "user.invite_mail_failed": "Falló el envío de la invitación",
  "user.signatures": "Firmas actualizadas",
  "customer.create": "Cliente creado",
  "customer.update": "Cliente modificado",
  "customer.contact.add": "Contacto agregado",
  "customer.contact.remove": "Contacto eliminado",
  "customer.address.add": "Dirección agregada",
  "customer.address.remove": "Dirección eliminada",
  "product.create": "Producto creado",
  "product.update": "Producto modificado",
  "product.import": "Lista de precios importada",
  "fx.update": "Tipo de cambio actualizado",
  "quote.create": "Cotización creada",
  "quote.update": "Cotización modificada",
  "quote.delete": "Cotización eliminada",
  "quote.status": "Cambio de estado de cotización",
  "quote.email": "Cotización enviada por correo",
  "quote.whatsapp": "Cotización enviada por WhatsApp",
  "sale.confirm": "Venta confirmada",
  "sale.cancel": "Venta cancelada",
  "sale.expenses": "Gastos de venta actualizados",
  "payment.create": "Pago registrado",
  "payment.void": "Pago anulado",
  "inventory.in": "Entrada de inventario",
  "inventory.out": "Salida de inventario",
  "inventory.adjust": "Ajuste de inventario",
  "inventory.sale_out": "Salida por venta",
  "inventory.reversal": "Corrección de movimiento",
  "inventory.reverse": "Movimiento revertido",
  "inventory.min_stock": "Stock mínimo actualizado",
  "warehouse.create": "Almacén creado",
  "commission.calculate": "Comisiones calculadas",
  "commission.approve": "Comisiones aprobadas",
  "commission.pay": "Comisiones pagadas",
  "commission.target": "Meta de ventas asignada",
  "commission.period.create": "Periodo de comisiones creado",
  "commission.period.close": "Periodo de comisiones cerrado",
  "commission.ruleset.create": "Reglas de comisión creadas",
  "commission.ruleset.activate": "Reglas de comisión activadas",
  "report.email": "Reporte enviado por correo",
  "report.whatsapp": "Reporte enviado por WhatsApp",
  "report.share_download": "Reporte descargado desde enlace",
  "job.daily": "Proceso automático diario",
  activate: "Activación",
};

export const ENTITY_LABEL: Record<string, string> = {
  User: "Usuario",
  Customer: "Cliente",
  Product: "Producto",
  ExchangeRate: "Tipo de cambio",
  Quote: "Cotización",
  Sale: "Venta",
  InventoryMovement: "Movimiento de inventario",
  StockBalance: "Existencias",
  Warehouse: "Almacén",
  CommissionPeriod: "Periodo de comisiones",
  CommissionRuleSet: "Reglas de comisión",
  SalesTarget: "Meta de ventas",
  Report: "Reporte",
  System: "Sistema",
};

const FIELD_LABEL: Record<string, string> = {
  email: "Correo", name: "Nombre", folio: "Folio", quoteFolio: "Cotización", status: "Estado",
  total: "Total", amount: "Monto", balance: "Saldo", rate: "Tipo de cambio", priceFrom: "Precio anterior",
  priceTo: "Precio nuevo", from: "De", to: "Para", cc: "Copia", recipients: "Destinatarios", auto: "Automático",
  roleId: "Rol", roleFrom: "Rol anterior", roleTo: "Rol nuevo", active: "Activo", invited: "Invitado por correo",
  passwordReset: "Contraseña cambiada", html: "Firma de correo", block: "Bloque de cotización",
  reason: "Motivo", method: "Forma de pago", phone: "Teléfono", channel: "Canal", quantity: "Cantidad",
  minStock: "Stock mínimo", warehouseId: "Almacén", sellerId: "Vendedor", tipo: "Tipo", desde: "Desde", hasta: "Hasta",
  created: "Creados", updated: "Actualizados", unchanged: "Sin cambios", errors: "Con errores",
  version: "Versión", entries: "Reglas", ruleSet: "Conjunto de reglas", contactId: "Contacto", addressId: "Dirección",
  paymentId: "Pago", reverses: "Revierte movimiento",
};

const METHOD_LABEL: Record<string, string> = {
  TRANSFER: "Transferencia", CASH: "Efectivo", CARD: "Tarjeta", CHECK: "Cheque", OTHER: "Otro",
};

const MONEY = new Set(["total", "amount", "balance", "priceFrom", "priceTo"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/;

export const actionLabel = (a: string) => ACTION_LABEL[a] ?? a;
export const entityLabel = (e: string) => ENTITY_LABEL[e] ?? e;

/** Identificadores (uuid) que aparecen en los detalles, para resolver nombres de usuarios, roles o almacenes. */
export function detailIds(data: unknown): string[] {
  if (!data || typeof data !== "object") return [];
  return Object.values(data).filter((v): v is string => typeof v === "string" && UUID.test(v));
}

function value(key: string, v: unknown, names: Map<string, string>): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (Array.isArray(v)) return v.map((x) => value(key, x, names)).join(", ") || "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (MONEY.has(key)) return fmtMoney(s);
  if (key === "method") return METHOD_LABEL[s] ?? s;
  if (key === "folio" || key === "quoteFolio") return `C-${s}`;
  if (s in QUOTE_STATUS_LABEL) return QUOTE_STATUS_LABEL[s as QuoteStatus];
  if (UUID.test(s)) return names.get(s) ?? s.slice(0, 8);
  if (ISO.test(s)) return fmtDate(s);
  return s;
}

/** Convierte el JSON técnico del evento en renglones "Etiqueta: valor" legibles. */
export function describeDetail(action: string, data: unknown, names: Map<string, string>): { label: string; value: string }[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data ? [{ label: "Detalle", value: JSON.stringify(data) }] : [];
  const d = data as Record<string, unknown>;
  // Un cambio de rol sin cambio real no aporta: se omite.
  const skip = new Set<string>(d.roleFrom !== undefined && d.roleFrom === d.roleTo ? ["roleFrom", "roleTo"] : []);
  const folioLabel = action.startsWith("sale.") ? "V-" : "C-";
  return Object.entries(d)
    .filter(([k]) => !skip.has(k))
    .map(([k, v]) => ({
      label: FIELD_LABEL[k] ?? k,
      value: k === "folio" && v != null ? `${folioLabel}${String(v)}` : value(k, v, names),
    }));
}
