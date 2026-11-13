"use client";

import { FolderOpen } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

export function EmptyState({
  title,
  description,
  icon: Icon = FolderOpen,
  action,
  onClick,
  disabled = false,
}: {
  title: string;
  description: string;
  icon?: typeof FolderOpen;
  action?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const reduceMotion = useReducedMotion();

  const Title = onClick ? "span" : "h2";
  const Description = onClick ? "span" : "p";
  const animation = {
    initial: reduceMotion ? false as const : { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduceMotion ? 0 : 0.18 },
  };
  const className = "rounded-xl border border-dashed border-border bg-muted/40 px-6 py-12 text-center";
  const content = <>
      <span className="mx-auto grid size-11 place-items-center rounded-xl border border-border bg-surface text-foreground-muted">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <Title className="mt-4 block font-semibold text-foreground">{title}</Title>
      <Description className="mx-auto mt-2 block max-w-md text-sm leading-6 text-foreground-muted">
        {description}
      </Description>
  </>;
  if (onClick) return <motion.button {...animation} type="button" onClick={onClick} disabled={disabled}
    className={`${className} block w-full cursor-pointer transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-wait disabled:opacity-60`}>
    {content}
  </motion.button>;
  return <motion.div {...animation} className={className}>{content}{action && <div className="mt-5">{action}</div>}</motion.div>;
}
