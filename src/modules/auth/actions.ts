"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { verifyCredentials } from "@/modules/users/service";
import { runAction, type ActionResult } from "@/lib/errors";
import { requestPasswordReset, resetPassword } from "./service";

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

// Límite por correo para no saturar buzones ni el SMTP (en memoria, por instancia).
const resetRequests = new Map<string, { n: number; until: number }>();
const RESET_SENT = "Si el correo está registrado, te enviamos un enlace para restablecer la contraseña. Revisa tu bandeja de entrada.";

export async function requestPasswordResetAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const { email } = z.object({ email: z.string().trim().email("Correo inválido").max(200) }).parse({ email: fd.get("email") });
    const key = email.toLowerCase();
    const r = resetRequests.get(key);
    const active = r && r.until > Date.now();
    // Pasado el límite se responde igual que siempre, sin enviar más correos.
    if (active && r.n >= 3) return undefined;
    resetRequests.set(key, { n: (active ? r.n : 0) + 1, until: active ? r.until : Date.now() + 15 * 60_000 });
    await requestPasswordReset(key);
    return undefined;
  }, RESET_SENT);
}

const newPassword = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(10, "Mínimo 10 caracteres").max(100),
  confirm: z.string(),
}).refine((d) => d.password === d.confirm, { path: ["confirm"], message: "Las contraseñas no coinciden" });

export async function resetPasswordAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const res = await runAction(async () => {
    const d = newPassword.parse({ token: fd.get("token"), password: fd.get("password"), confirm: fd.get("confirm") });
    await resetPassword(d.token, d.password);
  });
  if (res.ok) redirect("/login?restablecida=1");
  return res;
}
