import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Llave de 32 bytes desde PARTNER_TOTP_KEY (hex de 64 caracteres o base64). Falla en voz alta si falta o es inválida. */
function totpKey(): Buffer {
  const raw = process.env.PARTNER_TOTP_KEY?.trim();
  if (!raw) throw new Error("Falta PARTNER_TOTP_KEY.");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PARTNER_TOTP_KEY debe ser de 32 bytes (hex de 64 o base64).");
  return key;
}

/** Cifra con AES-256-GCM. Formato `iv:tag:ct`, cada parte en base64 (compatible con prisma/seed.ts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", totpKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(":");
}

/** Descifra `iv:tag:ct`. Lanza si el formato es inválido o la etiqueta GCM no coincide (dato alterado). */
export function decryptSecret(enc: string): string {
  const parts = enc.split(":");
  if (parts.length !== 3) throw new Error("Secreto cifrado con formato inválido.");
  const [iv, tag, ct] = parts.map((p) => Buffer.from(p, "base64")) as [Buffer, Buffer, Buffer];
  const d = createDecipheriv("aes-256-gcm", totpKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString("utf8");
}
