import { CircleAlert, CircleCheck } from "lucide-react";

import type { AuthActionState } from "../types";

export function AuthMessage({ state }: { state: AuthActionState }) {
  if (state.status === "idle" || !state.message) return null;

  const isSuccess = state.status === "success";
  const Icon = isSuccess ? CircleCheck : CircleAlert;

  return (
    <div
      className={`flex gap-3 rounded-lg border px-3.5 py-3 text-sm leading-5 ${
        isSuccess
          ? "border-success/25 bg-success-soft text-success"
          : "border-destructive/25 bg-destructive-soft text-destructive"
      }`}
      role={isSuccess ? "status" : "alert"}
      aria-live="polite"
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{state.message}</span>
    </div>
  );
}
