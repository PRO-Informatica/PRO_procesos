"use client";

import { X, type LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { createElement, isValidElement, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/class-names";
import { motionTokens } from "@/lib/motion/tokens";

import { IconButton } from "./icon-button";

const FOCUSABLE = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useDialogAccessibility<T extends HTMLElement = HTMLDivElement>({ open, onClose, pending = false }: {
  open: boolean;
  onClose: () => void;
  pending?: boolean;
}) {
  const panelRef = useRef<T>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const pendingRef = useRef(pending);

  useEffect(() => {
    onCloseRef.current = onClose;
    pendingRef.current = pending;
  }, [onClose, pending]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("[data-dialog-initial-focus], " + FOCUSABLE)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!pendingRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const firstItem = focusable[0];
      const lastItem = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  return panelRef;
}

export function Dialog({
  title,
  description,
  icon: Icon,
  onClose,
  pending = false,
  children,
  size = "md",
  tone = "default",
}: {
  title: string;
  description?: string;
  icon?: LucideIcon | React.ReactNode;
  onClose: () => void;
  pending?: boolean;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  tone?: "default" | "destructive";
}) {
  const titleId = useId();
  const descriptionId = useId();
  const reduceMotion = useReducedMotion();
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestClose = useCallback(() => {
    if (pending || closing) return;
    if (reduceMotion) {
      onClose();
      return;
    }
    setClosing(true);
    closeTimerRef.current = setTimeout(onClose, motionTokens.duration.hover * 1000);
  }, [closing, onClose, pending, reduceMotion]);
  const panelRef = useDialogAccessibility({ open: true, onClose: requestClose, pending: pending || closing });

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/50 p-2 pb-[max(.5rem,env(safe-area-inset-bottom))] pt-[max(.5rem,env(safe-area-inset-top))] backdrop-blur-[2px] sm:p-6"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: closing ? 0 : 1 }}
      transition={{ duration: reduceMotion ? 0 : motionTokens.duration.hover }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <motion.div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-busy={pending}
        className={cn(
          "my-auto flex max-h-[calc(100dvh-1rem)] w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl",
          size === "sm" && "max-w-lg",
          size === "md" && "max-w-2xl",
          size === "lg" && "max-w-4xl",
          size === "xl" && "max-w-5xl",
          size === "full" && "max-w-[80rem]",
        )}
        initial={reduceMotion ? false : { opacity: 0, y: 10, scale: motionTokens.scale.dialog }}
        animate={closing ? { opacity: 0, y: 8, scale: motionTokens.scale.dialog } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.22, ease: motionTokens.ease }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:gap-4 sm:px-6 sm:py-4">
          <div className="flex min-w-0 gap-3">
            {Icon && (
              <span className={cn(
                "grid size-10 shrink-0 place-items-center rounded-xl",
                tone === "destructive" ? "bg-destructive-soft text-destructive" : "bg-brand-soft text-brand-strong",
              )}>
                {isValidElement(Icon) ? Icon : createElement(Icon as LucideIcon, { "aria-hidden": true, className: "size-5" })}
              </span>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="font-semibold text-foreground">{title}</h2>
              {description && <p id={descriptionId} className="mt-1 text-xs leading-5 text-foreground-muted">{description}</p>}
            </div>
          </div>
          <IconButton label="Cerrar" onClick={requestClose} disabled={pending || closing} tooltipSide="bottom">
            <X aria-hidden="true" className="size-5" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-surface px-4 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] [&>*]:w-full sm:static sm:flex-row sm:items-center sm:justify-end sm:gap-3 sm:px-6 sm:py-4 [&>*]:sm:w-auto">
      {children}
    </div>
  );
}
