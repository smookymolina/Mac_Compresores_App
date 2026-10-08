"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { verifyCredentials } from "@/modules/users/service";
import { clearLoginFailures, clientIp, isLoginBlocked, purgeLoginAttempts, recordLoginFailure } from "@/lib/auth/rate-limit";
import type { ActionResult } from "@/lib/errors";

const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) });

export async function loginAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { ok: false, error: "Correo o contraseña inválidos." };
  const key = parsed.data.email.toLowerCase();
  const ip = await clientIp();
  if (await isLoginBlocked(key, ip)) return { ok: false, error: "Demasiados intentos. Espera 15 minutos." };

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) {
    await recordLoginFailure(key, ip);
    await audit({ userId: null, action: "auth.login_failed", entity: "User", data: { email: key } });
    return { ok: false, error: "Correo o contraseña inválidos." };
  }
  await clearLoginFailures(key, ip);
  void purgeLoginAttempts().catch(() => {});
  await createSession(user.id);
  await audit({ userId: user.id, action: "auth.login", entity: "User", entityId: user.id });
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
