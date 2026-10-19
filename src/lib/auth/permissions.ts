export const PERMISSIONS = [
  "users.manage",
  "products.read",
  "products.write",
  "products.import",
  "customers.read",
  "customers.write",
  "quotes.read_all",
  "quotes.read_own",
  "quotes.write",
  "quotes.delete",
  "quotes.override_price",
  "quotes.assign_seller", // asignar la cotización a otro vendedor: solo ADMIN
  "quotes.approve_discount", // autorizar descuentos de otros roles: solo ADMIN
  "inventory.read",
  "inventory.write",
  "sales.read_all",
  "sales.read_own",
  "sales.create",
  "commissions.read_all",
  "commissions.read_own",
  "commissions.manage",
  "commissions.approve",
  "dashboard.read",
  "audit.read",
  "payments.write",
  "reports.export",
  "complements.manage", // catálogo de complementos/condiciones y servicios: solo ADMIN
  "partners.manage", // portal de socios comerciales (socios, descuentos, actividad): solo ADMIN
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type RoleCode = "ADMIN" | "GERENCIA" | "VENTAS" | "ALMACEN";

/** Fuente de verdad para el seed; en tiempo de ejecución se leen de la BD. */
export const ROLE_PERMISSIONS: Record<RoleCode, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  GERENCIA: [
    "products.read", "products.write", "products.import",
    "customers.read", "customers.write",
    "quotes.read_all", "quotes.read_own", "quotes.write", "quotes.override_price",
    "inventory.read",
    "sales.read_all", "sales.read_own", "sales.create",
    // Comisiones solo de consulta; sin auditoría.
    "commissions.read_all", "commissions.read_own",
    "dashboard.read", "payments.write", "reports.export",
  ],
  VENTAS: [
    "products.read",
    "customers.read", "customers.write",
    "quotes.read_own", "quotes.write",
    "inventory.read",
    "sales.read_own", "sales.create",
    "commissions.read_own",
    "dashboard.read",
  ],
  // Solo catálogo y almacén.
  ALMACEN: ["products.read", "inventory.read", "inventory.write"],
};

export const ROLE_NAMES: Record<RoleCode, string> = {
  ADMIN: "Administrador",
  GERENCIA: "Gerencia",
  VENTAS: "Ventas",
  ALMACEN: "Almacén",
};

/** Descuento máximo por partida sin permiso de sobrescritura de precio. */
export const MAX_DISCOUNT_WITHOUT_OVERRIDE = 0.15;
