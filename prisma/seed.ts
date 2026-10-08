/**
 * Seed de desarrollo. Datos base reales: roles, permisos y tabla de comisiones proporcionada por MAC
 * (queda en BORRADOR hasta confirmar el criterio comercial).
 * Con SEED_DEMO=1 agrega datos FICTICIOS marcados con "[DEMO]".
 */
import { PrismaClient, type ProductLine } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PERMISSIONS, ROLE_NAMES, ROLE_PERMISSIONS, type RoleCode } from "../src/lib/auth/permissions";

const db = new PrismaClient();

// Tabla de comisiones (imagen): verde = meta cumplida, rojo = meta no cumplida.
const COMMISSION_TABLE: [ProductLine, string, string][] = [
  ["EQUIPO_VENTA", "0.10", "0.07"],
  ["RENTA", "0.07", "0.035"],
  ["REFACCIONES", "0.07", "0.035"],
  ["TUBERIA", "0.10", "0.06"],
  ["SERVICIOS", "0.08", "0.04"],
  ["KITS", "0.06", "0.03"],
  ["VALVULAS_OTROS", "0.04", "0.02"],
];

async function main() {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 8) throw new Error("Define SEED_ADMIN_PASSWORD (mín. 8 caracteres) en .env");

  for (const code of PERMISSIONS) await db.permission.upsert({ where: { code }, create: { code }, update: {} });
  const perms = new Map((await db.permission.findMany()).map((p) => [p.code, p.id]));

  const roles = {} as Record<RoleCode, string>;
  for (const code of Object.keys(ROLE_PERMISSIONS) as RoleCode[]) {
    const role = await db.role.upsert({ where: { code }, create: { code, name: ROLE_NAMES[code] }, update: { name: ROLE_NAMES[code] } });
    roles[code] = role.id;
    await db.rolePermission.deleteMany({ where: { roleId: role.id } });
    await db.rolePermission.createMany({ data: ROLE_PERMISSIONS[code].map((p) => ({ roleId: role.id, permissionId: perms.get(p)! })) });
  }

  const hash = await bcrypt.hash(adminPassword, 12);
  await db.user.upsert({
    where: { email: "admin@maccompresores.local" },
    create: { email: "admin@maccompresores.local", name: "Administrador", passwordHash: hash, roleId: roles.ADMIN },
    update: {},
  });

  await db.warehouse.upsert({ where: { code: "PRINCIPAL" }, create: { code: "PRINCIPAL", name: "Almacén principal" }, update: {} });

  if (!(await db.commissionRuleSet.findFirst({ where: { name: "Tabla de comisiones MAC" } }))) {
    await db.commissionRuleSet.create({
      data: {
        name: "Tabla de comisiones MAC",
        version: 1,
        basis: "NET_SALES",
        status: "DRAFT",
        notes: "Pendiente confirmar: base (venta neta / margen / cobranza) y definición de meta por vendedor.",
        rates: { create: COMMISSION_TABLE.map(([line, rateMet, rateNotMet]) => ({ line, rateMet, rateNotMet })) },
      },
    });
  }

  if (process.env.SEED_DEMO === "1") await demo(roles, hash);
  console.log("Seed completo.");
}

async function demo(roles: Record<RoleCode, string>, hash: string) {
  const users: [string, string, RoleCode][] = [
    ["ventas1@demo.local", "[DEMO] Vendedor Uno", "VENTAS"],
    ["ventas2@demo.local", "[DEMO] Vendedor Dos", "VENTAS"],
    ["almacen@demo.local", "[DEMO] Almacenista", "ALMACEN"],
    ["gerencia@demo.local", "[DEMO] Gerente", "GERENCIA"],
  ];
  for (const [email, name, role] of users) {
    await db.user.upsert({ where: { email }, create: { email, name, passwordHash: hash, roleId: roles[role] }, update: {} });
  }
  const products: [string, string, ProductLine, "PRODUCT" | "SERVICE", string, string][] = [
    ["DEMO-SEP-001", "[DEMO] Separador aire/aceite", "REFACCIONES", "PRODUCT", "1000", "1500"],
    ["DEMO-FIL-002", "[DEMO] Elemento filtro de aire", "REFACCIONES", "PRODUCT", "400", "650"],
    ["DEMO-KIT-003", "[DEMO] Kit válvula de admisión", "KITS", "PRODUCT", "3000", "4800"],
    ["DEMO-SRV-004", "[DEMO] Servicio preventivo compresor tornillo", "SERVICIOS", "SERVICE", "0", "3500"],
    ["DEMO-EQP-005", "[DEMO] Compresor tornillo 15 HP", "EQUIPO_VENTA", "PRODUCT", "90000", "125000"],
  ];
  const wh = await db.warehouse.findUniqueOrThrow({ where: { code: "PRINCIPAL" } });
  const admin = await db.user.findUniqueOrThrow({ where: { email: "admin@maccompresores.local" } });
  for (const [sku, description, line, kind, cost, price] of products) {
    const p = await db.product.upsert({
      where: { sku },
      create: { sku, description, line, kind, unit: kind === "SERVICE" ? "SERV" : "PZA", cost, price },
      update: {},
    });
    if (kind === "PRODUCT" && !(await db.stockBalance.findFirst({ where: { productId: p.id } }))) {
      await db.stockBalance.create({ data: { productId: p.id, warehouseId: wh.id, quantity: 10, minStock: 2 } });
      await db.inventoryMovement.create({
        data: { productId: p.id, warehouseId: wh.id, type: "IN", quantity: 10, reason: "[DEMO] Inventario inicial", userId: admin.id },
      });
    }
  }
  const seller = await db.user.findUniqueOrThrow({ where: { email: "ventas1@demo.local" } });
  if (!(await db.customer.findFirst({ where: { legalName: { startsWith: "[DEMO]" } } }))) {
    await db.customer.create({
      data: {
        legalName: "[DEMO] Industrias Ejemplo SA de CV",
        rfc: "IEJ010101AAA",
        paymentTermsDays: 30,
        ownerId: seller.id,
        contacts: { create: { name: "[DEMO] Contacto Compras", email: "compras@demo.local" } },
        addresses: { create: { street: "[DEMO] Calle Ficticia 123", city: "Ciudad", state: "Estado" } },
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
