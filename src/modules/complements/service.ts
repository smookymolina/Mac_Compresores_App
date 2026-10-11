import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import type { CurrentUser } from "@/lib/auth/session";
import type { ComplementOption } from "./match";

export const listPackages = (all = false) =>
  db.complementPackage.findMany({ where: all ? {} : { active: true }, orderBy: [{ position: "asc" }, { code: "asc" }] });

export async function packageOptions(): Promise<ComplementOption[]> {
  return (await listPackages()).map(({ code, name, activities, warrantyMonths, skuPatterns }) => ({ code, name, activities, warrantyMonths, skuPatterns }));
}

export interface PackageInput {
  code: string;
  name: string;
  activities: string[];
  warrantyMonths: number;
  skuPatterns: string[];
  position: number;
  active: boolean;
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
