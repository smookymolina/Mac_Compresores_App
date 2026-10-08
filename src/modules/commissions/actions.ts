"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { decimalStr, formObject, pctToFraction, uuid } from "@/lib/validation";
import { LINES } from "@/modules/products/lines";
import {
  activateRuleSet, approveSeller, calculatePeriod, closePeriod, createPeriod, createRuleSetVersion, markSellerPaid, setTarget,
} from "./service";

const done = <T,>(res: ActionResult<T>, path = "/comisiones") => {
  if (res.ok) revalidatePath(path, "layout");
  return res;
};

export async function createRuleSetAction(_: ActionResult<unknown> | null, fd: FormData) {
  return done(
    await runAction(async () => {
      const user = await requirePermission("commissions.manage");
      const raw = formObject(fd);
      const rates = LINES.map((line) => ({
        line,
        rateMet: pctToFraction.parse(raw[`met_${line}`]),
        rateNotMet: pctToFraction.parse(raw[`not_${line}`]),
      }));
      const base = z.object({
        name: z.string().trim().min(3).max(100),
        basis: z.enum(["NET_SALES", "MARGIN", "COLLECTED"]),
        notes: z.string().trim().max(1000).optional(),
      }).parse(raw);
      await createRuleSetVersion(user, { ...base, rates });
    }, "Nueva versión creada en borrador."),
  );
}

export async function activateRuleSetAction(id: string, _: ActionResult<unknown> | null) {
  return done(
    await runAction(async () => {
      const user = await requirePermission("commissions.approve");
      await activateRuleSet(user, id);
    }, "Regla activada."),
  );
}

export async function createPeriodAction(_: ActionResult<unknown> | null, fd: FormData) {
  return done(
    await runAction(async () => {
      const user = await requirePermission("commissions.manage");
      const d = z.object({
        name: z.string().trim().min(3).max(60),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
      }).parse(formObject(fd));
      await createPeriod(user, d);
    }, "Periodo creado."),
  );
}

export async function setTargetAction(periodId: string, _: ActionResult<unknown> | null, fd: FormData) {
  return done(
    await runAction(async () => {
      const user = await requirePermission("commissions.manage");
      const d = z.object({ sellerId: uuid, amount: decimalStr({ min: 0, scale: 2 }) }).parse(formObject(fd));
      await setTarget(user, periodId, d.sellerId, d.amount);
    }, "Meta guardada."),
  );
}

export async function calculatePeriodAction(periodId: string, _: ActionResult<unknown> | null) {
  return done(
    await runAction(async () => {
      const user = await requirePermission("commissions.manage");
      const n = await calculatePeriod(user, periodId);
      return n;
    }, "Comisiones calculadas."),
  );
}

export async function approveSellerAction(periodId: string, sellerId: string, _: ActionResult<unknown> | null) {
  return done(
    await runAction(async () => {
      const user = await requirePermission("commissions.approve");
      await approveSeller(user, periodId, sellerId);
    }, "Comisiones aprobadas."),
  );
}

export async function paySellerAction(periodId: string, sellerId: string, _: ActionResult<unknown> | null) {
  return done(
    await runAction(async () => {
      const user = await requirePermission("commissions.approve");
      await markSellerPaid(user, periodId, sellerId);
    }, "Marcadas como pagadas."),
  );
}

export async function closePeriodAction(periodId: string, _: ActionResult<unknown> | null) {
  return done(
    await runAction(async () => {
      const user = await requirePermission("commissions.approve");
      await closePeriod(user, periodId);
    }, "Periodo cerrado."),
  );
}
