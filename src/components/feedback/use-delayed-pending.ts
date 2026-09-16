"use client";

import { useEffect, useState } from "react";

export const LOADING_INDICATOR_DELAY_MS = 180;

/**
 * Delays only the visual loading treatment so fast operations do not flash.
 * The underlying action remains pending immediately and is never delayed.
 */
export function useDelayedPending(
  pending: boolean,
  delay = LOADING_INDICATOR_DELAY_MS,
) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setVisible(pending),
      pending ? delay : 0,
    );
    return () => window.clearTimeout(timer);
  }, [delay, pending]);

  return pending && visible;
}
