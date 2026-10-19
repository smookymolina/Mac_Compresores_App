import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export { fmtDate, fmtDateTime } from "@/domain/format";

/** Lee un searchParam como string simple. */
export function sp(v: string | string[] | undefined) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}
