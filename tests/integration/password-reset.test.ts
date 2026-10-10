import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

const sent: { to: string; subject: string; text: string; html: string }[] = [];
let mailOk = true;
vi.mock("@/lib/mail", () => ({
  isMailConfigured: () => true,
  sendMail: async (m: { to: string; subject: string; text: string; html: string }) => {
    if (!mailOk) throw new Error("SMTP caído");
    sent.push(m);
  },
}));

const { requestPasswordReset, resetPassword, isResetTokenValid, isInvitationValid, acceptInvitation } = await import("@/modules/auth/service");
const { createUser, resendInvitation, verifyCredentials } = await import("@/modules/users/service");

let userId: string;
let roleId: string;
const tokenFromMail = () => sent.findLast((m) => /token=/.test(m.text))!.text.match(/token=([\w-]+)/)![1]!;
const actor = { id: "", name: "Admin Pruebas", email: "admin-invita@t", role: "ADMIN", roleName: "Administrador", permissions: new Set() };
const admin = actor as never;

beforeAll(async () => {
  process.env.APP_URL = "https://app.test/";
  const role = await db.role.upsert({ where: { code: "VENTAS" }, create: { code: "VENTAS", name: "VENTAS" }, update: {} });
  roleId = role.id;
  await db.user.deleteMany({ where: { email: { in: ["reset@t", "inactivo@t", "invitado@t", "sincorreo@t", "admin-invita@t"] } } });
  actor.id = (await db.user.create({ data: { email: "admin-invita@t", name: "Admin Pruebas", passwordHash: "x", roleId: role.id } })).id;
  userId = (await db.user.create({ data: { email: "reset@t", name: "Reset", passwordHash: await bcrypt.hash("anterior-123", 4), roleId: role.id } })).id;
  await db.user.create({ data: { email: "inactivo@t", name: "Inactivo", passwordHash: "x", roleId: role.id, active: false } });
});

beforeEach(() => { sent.length = 0; mailOk = true; });
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
    expect(sent[0]!.html).toContain("Elegir nueva contraseña");
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
    // Aviso de seguridad en segundo plano.
    await vi.waitFor(() => expect(sent.some((m) => m.subject.startsWith("Tu contraseña se cambió"))).toBe(true));
  });

  it("rechaza tokens vencidos", async () => {
    await requestPasswordReset("reset@t");
    const token = tokenFromMail();
    await db.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(resetPassword(token, "otra-clave-segura")).rejects.toThrow(/no es válido/);
  });
});

describe("invitaciones", () => {
  it("crea al usuario sin contraseña utilizable y envía un enlace de 72 h", async () => {
    const r = await createUser(admin, { name: "Invitado", email: "Invitado@t", roleId });
    expect(r.mailed).toBe(true);
    const u = await db.user.findUniqueOrThrow({ where: { id: r.userId } });
    expect(u.invitePending).toBe(true);
    expect(sent[0]!.to).toBe("invitado@t");
    expect(sent[0]!.text).toContain("https://app.test/invitacion?token=");
    expect(sent[0]!.html).toContain("Activar mi cuenta");
    expect(sent[0]!.text).toContain("Admin Pruebas");
    const token = tokenFromMail();
    expect(await isInvitationValid(token)).toBe(true);
    // Un token de invitación no sirve para restablecer, ni al revés.
    expect(await isResetTokenValid(token)).toBe(false);
    await expect(resetPassword(token, "clave-cualquiera")).rejects.toThrow(/no es válido/);
    const t = await db.passwordResetToken.findFirstOrThrow({ where: { userId: u.id, purpose: "INVITE" } });
    const hours = (t.expiresAt.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71.9);
    expect(hours).toBeLessThanOrEqual(72);
  });

  it("reenviar anula el enlace anterior; activar fija la contraseña una sola vez", async () => {
    const u = await db.user.findUniqueOrThrow({ where: { email: "invitado@t" } });
    await resendInvitation(admin, u.id);
    const fresh = tokenFromMail();
    await expect(acceptInvitation("x".repeat(43), "clave-invitado-1")).rejects.toThrow(/no es válida/);
    expect(await acceptInvitation(fresh, "clave-invitado-1")).toBe(u.id);
    expect(await verifyCredentials("invitado@t", "clave-invitado-1")).not.toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).invitePending).toBe(false);
    await expect(acceptInvitation(fresh, "otra-clave-123")).rejects.toThrow(/no es válida/);
    await expect(resendInvitation(admin, u.id)).rejects.toThrow(/ya activó/);
  });

  it("si el correo falla, el usuario se crea igual y se informa", async () => {
    mailOk = false;
    const r = await createUser(admin, { name: "Sin correo", email: "sincorreo@t", roleId });
    expect(r.mailed).toBe(false);
    expect((await db.user.findUniqueOrThrow({ where: { id: r.userId } })).invitePending).toBe(true);
    await expect(createUser(admin, { name: "Duplicado", email: "sincorreo@t", roleId })).rejects.toThrow(/Ya existe/);
  });
});
