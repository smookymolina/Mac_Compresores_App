import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const sent: { to: string; text: string }[] = [];
vi.mock("@/lib/mail", () => ({
  isMailConfigured: () => true,
  sendMail: async (m: { to: string; text: string }) => { sent.push(m); },
}));

const { requestPasswordReset, resetPassword, isResetTokenValid } = await import("@/modules/auth/service");

let userId: string;
const tokenFromMail = () => sent.at(-1)!.text.match(/token=([\w-]+)/)![1]!;

beforeAll(async () => {
  process.env.APP_URL = "https://app.test/";
  const role = await db.role.upsert({ where: { code: "VENTAS" }, create: { code: "VENTAS", name: "VENTAS" }, update: {} });
  await db.user.deleteMany({ where: { email: { in: ["reset@t", "inactivo@t"] } } });
  userId = (await db.user.create({ data: { email: "reset@t", name: "Reset", passwordHash: await bcrypt.hash("anterior-123", 4), roleId: role.id } })).id;
  await db.user.create({ data: { email: "inactivo@t", name: "Inactivo", passwordHash: "x", roleId: role.id, active: false } });
});

beforeEach(() => { sent.length = 0; });
afterAll(() => db.$disconnect());

describe("recuperación de contraseña", () => {
  it("no envía nada a correos inexistentes o inactivos", async () => {
    await requestPasswordReset("nadie@t");
    await requestPasswordReset("inactivo@t");
    expect(sent).toHaveLength(0);
  });

  it("envía un enlace de un solo uso con APP_URL; solo vale el más reciente", async () => {
    await requestPasswordReset("RESET@t");
    const first = tokenFromMail();
    expect(sent[0]!.to).toBe("reset@t");
    expect(sent[0]!.text).toContain(`https://app.test/restablecer?token=${first}`);
    await requestPasswordReset("reset@t");
    const second = tokenFromMail();
    expect(await isResetTokenValid(first)).toBe(false);
    expect(await isResetTokenValid(second)).toBe(true);
    // El token en claro no se guarda.
    expect(await db.passwordResetToken.count({ where: { id: second } })).toBe(0);
  });

  it("cambia la contraseña, cierra sesiones y no permite reutilizar el token", async () => {
    await requestPasswordReset("reset@t");
    const token = tokenFromMail();
    await db.session.create({ data: { id: "s-reset", userId, expiresAt: new Date(Date.now() + 1e6) } });

    await resetPassword(token, "nueva-clave-segura");
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(await bcrypt.compare("nueva-clave-segura", u.passwordHash)).toBe(true);
    expect(await db.session.count({ where: { userId } })).toBe(0);
    await expect(resetPassword(token, "otra-clave-segura")).rejects.toThrow(/no es válido/);
  });

  it("rechaza tokens vencidos", async () => {
    await requestPasswordReset("reset@t");
    const token = tokenFromMail();
    await db.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(resetPassword(token, "otra-clave-segura")).rejects.toThrow(/no es válido/);
  });
});
