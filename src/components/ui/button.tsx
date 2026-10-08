import Link from "next/link";
import { cn } from "@/lib/utils";

export type BtnVariant = "primary" | "secondary" | "danger" | "ghost";
type BtnSize = "md" | "sm";

/** Clases de botón para elementos que no son <button>/<Link> (p. ej. <a> a una ruta de API). */
export const btnClass = (variant: BtnVariant = "primary", size: BtnSize = "md") =>
  cn("btn", `btn-${variant}`, size === "sm" && "btn-sm");

export function Button({
  variant = "primary", size = "md", className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: BtnSize }) {
  return <button className={cn(btnClass(variant, size), className)} {...props} />;
}

export function LinkButton({
  variant = "primary", size = "md", className, ...props
}: React.ComponentProps<typeof Link> & { variant?: BtnVariant; size?: BtnSize }) {
  return <Link className={cn(btnClass(variant, size), className)} {...props} />;
}
