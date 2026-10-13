// Sin "server-only": lo importa también el middleware (edge). Solo constantes.

/** `mac_partner` solo con COOKIE_SECURE=false (HTTP local); si no, `__Secure-mac_partner` (Secure, Path=/socios). */
export const PARTNER_COOKIE_SECURE = process.env.COOKIE_SECURE !== "false";
export const PARTNER_COOKIE = PARTNER_COOKIE_SECURE ? "__Secure-mac_partner" : "mac_partner";
/** Cookie firmada de corta vida entre la contraseña y el 2FA (aún no es una sesión). */
export const PARTNER_PRE_COOKIE = `${PARTNER_COOKIE}_pre`;
export const PARTNER_COOKIE_PATH = "/socios";
