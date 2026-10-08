"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { verifyCredentials } from "@/modules/users/service";
import type { ActionResult } from "@/lib/errors";

const schema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200) });

// Limitador simple en memoria (por instancia) contra fuerza bruta.
const attempts = new Map<string, { n: number; until: number }>();

export async function loginAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { ok: false, error: "Correo o contraseña inválidos." };
  const key = parsed.data.email.toLowerCase();
  const a = attempts.get(key);
  if (a && a.n >= 5 && a.until > Date.now()) return { ok: false, error: "Demasiados intentos. Espera 15 minutos." };

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) {
    attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    await audit({ userId: null, action: "auth.login_failed", entity: "User", data: { email: key } });
    return { ok: false, error: "Correo o contraseña inválidos." };
  }
  attempts.delete(key);
  await createSession(user.id);
  await audit({ userId: user.id, action: "auth.login", entity: "User", entityId: user.id });
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
