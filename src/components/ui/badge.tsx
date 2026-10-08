import { cn } from "@/lib/utils";

export type Tone = "neutral" | "blue" | "green" | "red" | "amber";
const tones: Record<Tone, string> = {
  neutral: "bg-panel-2 text-ink-soft ring-line",
  blue: "bg-accent-soft text-accent-fg ring-accent-fg/20",
  green: "bg-ok-soft text-ok ring-ok/20",
  red: "bg-danger-soft text-danger ring-danger/20",
  amber: "bg-warn-soft text-warn ring-warn/20",
};

/** Badge de estado: color + punto + texto (el color nunca es el único canal). */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone])}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}
