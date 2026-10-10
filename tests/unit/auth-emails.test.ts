import { describe, expect, it } from "vitest";
import { invitationEmail, passwordChangedEmail, passwordResetEmail } from "@/modules/auth/emails";

describe("correos de acceso", () => {
  it("restablecer: botón, vigencia y aviso si no lo solicitaste", () => {
    const m = passwordResetEmail({ name: "Ana <b>", link: "https://app.test/restablecer?token=abc", minutes: 30 });
    expect(m.subject).toContain("Restablece tu contraseña");
    expect(m.html).toContain("Seguridad de la cuenta");
    expect(m.html).toContain("Elegir nueva contraseña");
    expect(m.html).toContain("https://app.test/restablecer?token=abc");
    expect(m.html).not.toContain("Ana <b>");
    expect(m.text).toContain("vence en 30 minutos");
    expect(m.text).toContain("Si no lo solicitaste");
  });

  it("invitación: rol, quién invitó y botón de activación", () => {
    const m = invitationEmail({ name: "Luis", role: "Ventas", invitedBy: "Admin", link: "https://app.test/invitacion?token=xyz", hours: 72 });
    expect(m.subject).toBe("Te invitaron a MAC Compresores");
    expect(m.text).toContain("Rol: Ventas");
    expect(m.text).toContain("Invitado por: Admin");
    expect(m.text).toContain("Activar mi cuenta: https://app.test/invitacion?token=xyz");
    expect(m.text).toContain("72 horas");
    expect(m.html).toContain("Invitación");
  });

  it("contraseña cambiada", () => {
    const m = passwordChangedEmail({ name: "Ana", at: new Date("2026-10-10T18:00:00Z"), loginUrl: "https://app.test/login", recoverUrl: "https://app.test/recuperar" });
    expect(m.subject).toContain("Tu contraseña se cambió");
    expect(m.text).toContain("https://app.test/recuperar");
  });
});
