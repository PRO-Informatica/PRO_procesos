"use client";

import { useEffect, useRef } from "react";

import type { NotificationMessage } from "@/lib/notification-messages";
import { notify } from "@/lib/notify";

export function useActionNotification({
  pending,
  status,
  success,
  error,
}: {
  pending: boolean;
  status: "idle" | "success" | "error";
  success?: NotificationMessage;
  error?: NotificationMessage;
}) {
  const submitted = useRef(false);
  const handled = useRef(false);

  useEffect(() => {
    if (pending) {
      submitted.current = true;
      handled.current = false;
      return;
    }
    if (!submitted.current || handled.current) return;
    if (status === "success" && success) {
      notify.success(success);
      handled.current = true;
    } else if (status === "error") {
      if (error) notify.error(error);
      handled.current = true;
    }
  }, [error, pending, status, success]);
}
