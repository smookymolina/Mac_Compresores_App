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
  "quotes.override_price",
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
    "commissions.read_all", "commissions.read_own", "commissions.manage", "commissions.approve",
    "dashboard.read", "audit.read",
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
  ALMACEN: ["products.read", "inventory.read", "inventory.write", "sales.read_all", "dashboard.read"],
};

export const ROLE_NAMES: Record<RoleCode, string> = {
  ADMIN: "Administrador",
  GERENCIA: "Gerencia",
  VENTAS: "Ventas",
  ALMACEN: "Almacén",
};

/** Descuento máximo por partida sin permiso de sobrescritura de precio. */
export const MAX_DISCOUNT_WITHOUT_OVERRIDE = 0.15;
