import { cn } from "@/lib/class-names";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-muted text-foreground-muted",
  brand: "bg-brand-soft text-brand-strong",
  success: "bg-success-soft text-success",
  warning: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
  danger: "bg-destructive-soft text-destructive",
  info: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200",
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("status-feedback inline-flex max-w-full w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-4", toneClasses[tone], className)}>
      {dot && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function StatusBadge({ label, tone, dot = false }: { label: string; tone: BadgeTone; dot?: boolean }) {
  return <Badge tone={tone} dot={dot}>{label}</Badge>;
}
