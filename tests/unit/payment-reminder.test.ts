import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  REMINDER_COOLDOWN_MS, bankInfoLines, buildReminderEmail, defaultReminderMessage, nextReminderAt, overdueDays,
  reminderDraft, reminderRecipient,
} from "@/modules/payments/reminder";

const D = (v: string) => new Prisma.Decimal(v);
const facts = {
  folio: 42, customer: "Aceros <Norte> SA", total: D("11600"), paid: D("1600"), balance: D("10000"),
  due: new Date("2026-10-01T18:00:00Z"), today: new Date("2026-10-10T18:00:00Z"),
};
const seller = { name: "Ana Pérez", email: "ana@maccompresores.com.mx" };

describe("recordatorio de pago", () => {
  it("calcula días de atraso (0 si no ha vencido)", () => {
    expect(overdueDays(facts.due, facts.today)).toBe(9);
    expect(overdueDays(facts.today, facts.due)).toBe(0);
  });

  it("sugiere el correo del cliente o el del primer contacto con correo", () => {
    expect(reminderRecipient({ email: "pagos@cliente.mx", contacts: [{ email: "x@y.mx" }] })).toBe("pagos@cliente.mx");
    expect(reminderRecipient({ email: null, contacts: [{ email: null }, { email: "b@c.mx" }] })).toBe("b@c.mx");
    expect(reminderRecipient({ email: null, contacts: [] })).toBe("");
  });

  it("limita a un envío cada 12 horas", () => {
    const last = new Date("2026-10-10T08:00:00Z");
    expect(nextReminderAt(last, new Date("2026-10-10T12:00:00Z"))?.getTime()).toBe(last.getTime() + REMINDER_COOLDOWN_MS);
    expect(nextReminderAt(last, new Date("2026-10-10T20:00:01Z"))).toBeNull();
    expect(nextReminderAt(null)).toBeNull();
    const d = reminderDraft({ ...facts, customerContact: { email: "a@b.mx", contacts: [] }, lastSentAt: last });
    expect(d.lastSentAt).toBe(last.toISOString());
    expect(d.nextAllowedAt).not.toBeNull();
  });

  it("prellena un mensaje cordial con folio, saldo y atraso", () => {
    const m = defaultReminderMessage(facts);
    expect(m).toContain("V-42");
    expect(m).toContain("10,000.00");
    expect(m).toContain("9 días de atraso");
  });

  it("arma el correo de marca con detalles, datos bancarios y firma, escapando HTML", () => {
    const bank = bankInfoLines("Banco: BBVA| Titular: MAC Compresores |CLABE: 012345678901234567||");
    expect(bank).toEqual(["Banco: BBVA", "Titular: MAC Compresores", "CLABE: 012345678901234567"]);
    const e = buildReminderEmail({ ...facts, message: "Hola <b>\n\nSegundo párrafo", seller, bank });
    expect(e.subject).toBe("Recordatorio de pago · Venta V-42 · MAC Compresores");
    expect(e.html).toContain("Saldo pendiente de la venta V-42");
    expect(e.html).toContain("Recordatorio de pago");
    expect(e.html).toContain("Aceros &lt;Norte&gt; SA");
    expect(e.html).not.toContain("<b>\n");
    expect(e.html).toContain("Días de atraso");
    expect(e.text).toContain("CLABE: 012345678901234567");
    expect(e.text).toContain("Ana Pérez");
    const noBank = buildReminderEmail({ ...facts, today: new Date("2026-09-01T00:00:00Z"), message: "x", seller, bank: [] });
    expect(noBank.text).not.toContain("transferencia");
    expect(noBank.html).not.toContain("Días de atraso");
  });
});
