/** Actualizaciones de la app y alertas de pendientes (sin dependencias). */

/** Compara versiones semver `x.y.z[-pre]`: <0 si a<b, 0 si iguales, >0 si a>b. Una prerelease es menor que la final. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = "", pre = ""] = String(v ?? "").trim().replace(/^v/i, "").split(/[-+]/, 2);
    const n = core.split(".").map((x) => Number.parseInt(x, 10) || 0);
    return { n: [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0], pre };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

export interface UpdateInfo {
  current: string;
  latest: string | null;
  /** Hay una versión más nueva (`latest > current`). */
  available: boolean;
  /** El servidor exige actualizar (`minimum > current`). */
  required: boolean;
  notes: string;
}

export function updateInfo(current: string, v: { latest?: string | null; minimum?: string | null; notes?: string | null } | null): UpdateInfo {
  const latest = v?.latest || null;
  return {
    current, latest, notes: v?.notes ?? "",
    available: !!latest && compareSemver(latest, current) > 0,
    required: !!v?.minimum && compareSemver(v.minimum, current) > 0,
  };
}

type VersionLike = { latest?: string | null; minimum?: string | null; notes?: string | null; ios?: { latest?: string | null; minimum?: string | null; notes?: string | null } | null };

/**
 * Versión publicada que aplica a la plataforma. En iOS, si el servidor publica `ios` (IPA propio),
 * se compara contra `ios.latest`; el mínimo es `ios.minimum` (o el general), acotado a `ios.latest`
 * para no exigir una versión que aún no existe en iOS.
 */
export function versionFor<V extends VersionLike>(platform: string, v: V | null): VersionLike | null {
  if (!v || platform !== "ios" || !v.ios?.latest) return v;
  const latest = v.ios.latest;
  let minimum = v.ios.minimum ?? v.minimum ?? null;
  if (minimum && compareSemver(minimum, latest) > 0) minimum = latest;
  return { latest, minimum, notes: v.ios.notes ?? v.notes ?? "" };
}

/** URL que debe abrir el sistema (instalación OTA `itms-services:` u otro esquema no web), no un navegador embebido. */
export const isSystemUrl = (url: string) => /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url);

export const STALE_PENDING_MS = 24 * 3600_000;
export interface StalePending { count: number; since: string }

/** Pendientes con más de 24 h en el outbox (`since` = el más antiguo). */
export function stalePending(oldestQueuedAt: string | null | undefined, count: number, now: number, limitMs = STALE_PENDING_MS): StalePending | null {
  if (!count || !oldestQueuedAt) return null;
  const t = Date.parse(oldestQueuedAt);
  return Number.isFinite(t) && now - t > limitMs ? { count, since: oldestQueuedAt } : null;
}

/** Ruta relativa del servidor → URL absoluta con `base` (las absolutas se dejan igual). */
export const absoluteUrl = (base: string, url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`);
