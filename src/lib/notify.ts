"use client";

import { sileo, type SileoButton, type SileoOptions } from "sileo";

import type { NotificationMessage } from "./notification-messages";

type MessageInput = NotificationMessage | string;
type NotificationKind = "success" | "error" | "warning" | "info" | "action";

const durationByKind: Record<NotificationKind, number> = {
  success: 3200,
  info: 4200,
  warning: 6000,
  error: 7000,
  action: 8000,
};

const TECHNICAL_ERROR = /(?:stack trace|postgres|supabase|invalid input value for enum|violates .* constraint|relation .* does not exist|\bselect\b.+\bfrom\b|\binsert into\b|\bdelete from\b|\bat\s+\w+\s*\()/iu;
const SAFE_ERROR_DESCRIPTION = "No fue posible completar la operación. Intenta nuevamente.";

function options(input: MessageInput, kind: NotificationKind, description?: string): SileoOptions {
  const message = typeof input === "string" ? { title: input, description } : input;
  const safeDescription = kind === "error" && message.description && TECHNICAL_ERROR.test(message.description)
    ? SAFE_ERROR_DESCRIPTION
    : message.description;
  return {
    title: message.title,
    description: safeDescription,
    duration: durationByKind[kind],
  };
}

export const notify = {
  success(input: MessageInput, description?: string) {
    return sileo.success(options(input, "success", description));
  },
  error(input: MessageInput, description?: string) {
    return sileo.error(options(input, "error", description));
  },
  warning(input: MessageInput, description?: string) {
    return sileo.warning(options(input, "warning", description));
  },
  info(input: MessageInput, description?: string) {
    return sileo.info(options(input, "info", description));
  },
  action(input: MessageInput, button: SileoButton, description?: string) {
    return sileo.action({ ...options(input, "action", description), button });
  },
  dismiss(id: string) {
    sileo.dismiss(id);
  },
};
