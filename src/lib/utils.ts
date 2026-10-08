import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtDate(d: Date | string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" }).format(new Date(d));
}

export function fmtDateTime(d: Date | string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(d));
}

/** Lee un searchParam como string simple. */
export function sp(v: string | string[] | undefined) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}
