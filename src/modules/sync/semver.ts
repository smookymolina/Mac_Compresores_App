/** Versiones semánticas MAJOR.MINOR.PATCH (sin dependencias). Sufijos de pre-release se ignoran al comparar el núcleo y van antes. */
export const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export const isSemver = (v: string) => SEMVER_RE.test(v);

/** -1 si a < b, 0 si iguales, 1 si a > b. Una versión no válida se considera la más baja. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = SEMVER_RE.exec(a.trim());
  const pb = SEMVER_RE.exec(b.trim());
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d < 0 ? -1 : 1;
  }
  const [ra, rb] = [pa[4], pb[4]];
  if (ra === rb) return 0;
  if (!ra) return 1;
  if (!rb) return -1;
  return ra < rb ? -1 : 1;
}
