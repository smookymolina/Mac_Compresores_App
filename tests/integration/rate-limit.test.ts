import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "@/lib/auth/rate-limit";

describe("limitador de login persistente", () => {
  beforeEach(async () => {
    await db.loginAttempt.deleteMany();
  });

  it("bloquea el par correo+IP tras 5 fallos y un acceso correcto lo limpia", async () => {
    for (let i = 0; i < 4; i++) await recordLoginFailure("a@t", "1.1.1.1");
    expect(await isLoginBlocked("a@t", "1.1.1.1")).toBe(false);
    await recordLoginFailure("a@t", "1.1.1.1");
    expect(await isLoginBlocked("a@t", "1.1.1.1")).toBe(true);

    await db.loginAttempt.updateMany({ data: { lockedUntil: null } });
    await clearLoginFailures("a@t", "1.1.1.1");
    expect(await db.loginAttempt.count({ where: { key: "ei:a@t|1.1.1.1" } })).toBe(0);
  });

  it("un atacante desde otra IP no bloquea al usuario legítimo", async () => {
    for (let i = 0; i < 5; i++) await recordLoginFailure("v@t", "9.9.9.9");
    expect(await isLoginBlocked("v@t", "9.9.9.9")).toBe(true);
    expect(await isLoginBlocked("v@t", "2.2.2.2")).toBe(false);
  });

  it("los intentos viejos (fuera de la ventana) reinician el contador", async () => {
    await recordLoginFailure("o@t", "3.3.3.3");
    await db.$executeRaw`UPDATE "LoginAttempt" SET "updatedAt" = now() - interval '1 hour'`;
    await recordLoginFailure("o@t", "3.3.3.3");
    expect((await db.loginAttempt.findUnique({ where: { key: "ei:o@t|3.3.3.3" } }))?.count).toBe(1);
  });
});
