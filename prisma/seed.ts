/**
 * Seed de desarrollo. Datos base reales: roles, permisos y tabla de comisiones proporcionada por MAC
 * (queda en BORRADOR hasta confirmar el criterio comercial).
 * Con SEED_DEMO=1 agrega datos FICTICIOS marcados con "[DEMO]".
 */
import { PrismaClient, type ProductLine } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createCipheriv, randomBytes } from "node:crypto";
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
  const adminEmail = (process.env.SEED_ADMIN_EMAIL?.trim() || "admin@maccompresores.local").toLowerCase();
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
    where: { email: adminEmail },
    create: { email: adminEmail, name: "Administrador", passwordHash: hash, roleId: roles.ADMIN },
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

  // Ajustes del portal de socios (idempotente: update vacío para no pisar lo que cambie el admin).
  for (const [key, value] of [["partners.discountPct", 15], ["partners.dailyQuota", 80]] as const) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  if (process.env.SEED_DEMO === "1") await demo(roles, hash, adminEmail);
  console.log("Seed completo.");
}

async function demo(roles: Record<RoleCode, string>, hash: string, adminEmail: string) {
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
  const admin = await db.user.findUniqueOrThrow({ where: { email: adminEmail } });
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
  await demoPartner(hash);
}

/**
 * Socio DEMO solo para E2E (únicamente bajo SEED_DEMO=1; nunca en producción).
 *  - email: socio@demo.local / contraseña: Demo-Socio-2026!
 *  - Secreto TOTP CONOCIDO (base32): JBSWY3DPEHPK3PXP  (generar el código con otplib (secreto base32 JBSWY3DPEHPK3PXP))
 *  - Se guarda cifrado AES-256-GCM `iv:tag:ct` (base64) con PARTNER_TOTP_KEY (32 bytes en hex de 64 car. o base64).
 *  - Sin PARTNER_TOTP_KEY no se crea (el socio quedaría sin 2FA utilizable).
 */
async function demoPartner(_adminHash: string) {
  const rawKey = process.env.PARTNER_TOTP_KEY;
  if (!rawKey) return console.warn("SEED_DEMO: sin PARTNER_TOTP_KEY, se omite el socio demo.");
  const key = /^[0-9a-f]{64}$/i.test(rawKey) ? Buffer.from(rawKey, "hex") : Buffer.from(rawKey, "base64");
  if (key.length !== 32) throw new Error("PARTNER_TOTP_KEY debe ser de 32 bytes (hex de 64 o base64).");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update("JBSWY3DPEHPK3PXP", "utf8"), c.final()]);
  const totpSecretEnc = [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(":");
  const email = "socio@demo.local";
  await db.partner.upsert({
    where: { email },
    create: {
      email, name: "[DEMO] Socio Uno", company: "[DEMO] Socio Comercial SA",
      passwordHash: await bcrypt.hash("Demo-Socio-2026!", 12),
      totpSecretEnc, totpEnabledAt: new Date(),
    },
    update: {},
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
