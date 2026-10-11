"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { savePackage } from "./service";

const lines = (max: number, len: number) =>
  z.string().transform((s) => s.split(/[\n,]/).map((l) => l.trim()).filter(Boolean)).pipe(z.array(z.string().max(len)).max(max));

const schema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(40),
  name: z.string().trim().min(2).max(120),
  activities: z.string().transform((s) => s.split("\n").map((l) => l.replace(/^\s*\d+[.)-]*\s*/, "").trim()).filter(Boolean)).pipe(z.array(z.string().max(300)).max(60)),
  warrantyMonths: z.coerce.number().int().min(0).max(60),
  skuPatterns: lines(20, 60),
  position: z.coerce.number().int().min(0).max(999),
  active: z.literal("on").optional().transform((v) => v === "on"),
  shared: z.literal("on").optional().transform((v) => v === "on"),
});

export async function savePackageAction(id: string | undefined, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("complements.manage");
    await savePackage(user, id, schema.parse(Object.fromEntries(fd)));
  });
  if (res.ok) {
    revalidatePath("/productos/complementos");
    redirect("/productos/complementos");
  }
  return res;
}
