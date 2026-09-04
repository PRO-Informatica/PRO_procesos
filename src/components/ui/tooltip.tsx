"use client";

import { useId } from "react";

import { cn } from "@/lib/class-names";

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: string;
  children: React.ReactNode;
  side?: "top" | "bottom";
}) {
  const id = useId();

  return (
    <span className="group/tooltip relative inline-flex" aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-[120] w-max max-w-56 -translate-x-1/2 scale-[0.98] rounded-md bg-foreground px-2 py-1 text-center text-[11px] font-medium leading-4 text-surface opacity-0 shadow-md transition-[opacity,transform] duration-150 group-hover/tooltip:scale-100 group-hover/tooltip:opacity-100 group-focus-within/tooltip:scale-100 group-focus-within/tooltip:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {content}
      </span>
    </span>
  );
}
