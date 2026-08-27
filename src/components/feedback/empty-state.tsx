"use client";

import { FolderOpen } from "lucide-react";
import { motion } from "motion/react";

export function EmptyState({
  title,
  description,
  icon: Icon = FolderOpen,
  action,
}: {
  title: string;
  description: string;
  icon?: typeof FolderOpen;
  action?: React.ReactNode;
}) {
  return (
    <motion.div
      className="rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <span className="mx-auto grid size-11 place-items-center rounded-xl border border-border bg-surface text-foreground-muted">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <h2 className="mt-4 font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-foreground-muted">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </motion.div>
  );
}
