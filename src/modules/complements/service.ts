import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { can, type CurrentUser } from "@/lib/auth/session";
import type { ComplementOption } from "./match";

/** all = incluso deshabilitados; sharedOnly = solo los habilitados para los demás usuarios. */
export const listPackages = (all = false, sharedOnly = false) =>
  db.complementPackage.findMany({
    where: all ? {} : { active: true, ...(sharedOnly && { shared: true }) },
    orderBy: [{ position: "asc" }, { code: "asc" }],
  });

/** Paquetes que el usuario puede usar al cotizar: el admin ve todos los activos; los demás, solo los compartidos. */
export async function packageOptions(user: CurrentUser): Promise<ComplementOption[]> {
  return (await listPackages(false, !can(user, "complements.manage"))).map(({ code, name, activities, warrantyMonths, skuPatterns }) => ({ code, name, activities, warrantyMonths, skuPatterns }));
}

export interface PackageInput {
  code: string;
  name: string;
  activities: string[];
  warrantyMonths: number;
  skuPatterns: string[];
  position: number;
  active: boolean;
  shared: boolean;
}

/** Guarda un complemento personalizado de una cotización como paquete del catálogo; devuelve su clave. */
export async function savePackageFromQuote(user: CurrentUser, c: { name: string; activities: string[] }, shared: boolean, warrantyMonths: number) {
  const base = ("P-" + c.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "")).slice(0, 34) || "P-PERSONALIZADO";
  let code = base;
  for (let n = 2; await db.complementPackage.findUnique({ where: { code } }); n++) code = `${base}-${n}`;
  const pkg = await db.complementPackage.create({ data: { code, name: c.name || "Personalizado", activities: c.activities, warrantyMonths, skuPatterns: [], shared, position: 100 } });
  await audit({ userId: user.id, action: "complement.create", entity: "ComplementPackage", entityId: pkg.id, data: { code, fromQuote: true } });
  return code;
}

export async function savePackage(user: CurrentUser, id: string | undefined, input: PackageInput) {
  const dup = await db.complementPackage.findFirst({ where: { code: { equals: input.code, mode: "insensitive" }, ...(id && { id: { not: id } }) } });
  if (dup) throw new AppError(`Ya existe un paquete con la clave ${input.code}.`, "CONFLICT");
  const pkg = id
    ? await db.complementPackage.update({ where: { id }, data: input })
    : await db.complementPackage.create({ data: input });
  await audit({ userId: user.id, action: id ? "complement.update" : "complement.create", entity: "ComplementPackage", entityId: pkg.id, data: { code: pkg.code } });
  return pkg;
}
