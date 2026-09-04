"use client";

import { sileo } from "sileo";

import type { NotificationMessage } from "./notification-messages";

type MessageInput = NotificationMessage | string;

function options(input: MessageInput, description?: string) {
  const message = typeof input === "string" ? { title: input, description } : input;
  return {
    title: message.title,
    description: message.description,
    duration: message.description ? 4000 : 3000,
  };
}

export const notify = {
  success(input: MessageInput, description?: string) {
    return sileo.success(options(input, description));
  },
  error(input: MessageInput, description?: string) {
    return sileo.error(options(input, description));
  },
  warning(input: MessageInput, description?: string) {
    return sileo.warning(options(input, description));
  },
  info(input: MessageInput, description?: string) {
    return sileo.info(options(input, description));
  },
};
