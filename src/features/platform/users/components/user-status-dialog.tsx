"use client";

import { Power, PowerOff } from "lucide-react";
import { motion } from "motion/react";
import { useActionState, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

import { setPlatformUserStatus } from "../actions";
import { initialPlatformUserActionState } from "../types";

export function UserStatusDialog({ userId, userName, active, compact = false, disabled = false }: {
  userId: string;
  userName: string;
  active: boolean;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(setPlatformUserStatus, initialPlatformUserActionState);
  const activating = !active;
  useActionNotification({ pending, status: state.status, success: notifications.statusUpdated, error: notifications.actionFailed });

  return <>
    <motion.button type="button" disabled={disabled} onClick={() => setOpen(true)} className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${activating ? "border-success/25 text-success hover:bg-success-soft" : "border-border text-foreground-muted hover:bg-muted hover:text-foreground"}`} whileTap={disabled ? undefined : { scale: 0.98 }} title={disabled ? "No puedes desactivar tu propio usuario" : undefined} aria-label={`${activating ? "Activar" : "Desactivar"} ${userName}`}>
      {activating ? <Power aria-hidden="true" className="size-3.5" /> : <PowerOff aria-hidden="true" className="size-3.5" />}
      {!compact && (activating ? "Activar" : "Desactivar")}
    </motion.button>
    {open && <Dialog title={activating ? "Activar usuario" : "Desactivar usuario"} description={activating ? `${userName} recuperará su acceso.` : `${userName} perderá acceso funcional.`} icon={activating ? Power : PowerOff} onClose={() => setOpen(false)} pending={pending} tone={activating ? "default" : "destructive"} size="sm">
      <form action={formAction}>
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="active" value={String(activating)} />
        <div className="p-5 sm:p-6">
          <p className="text-sm leading-6 text-foreground-muted">Sus asignaciones, roles e historial se conservarán.</p>
          {state.status === "error" && <p className="mt-4 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive" role="alert">{state.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
          <LoadingButton loadingLabel={activating ? "Activando…" : "Desactivando…"} variant={activating ? "primary" : "destructive"}>{activating ? "Activar" : "Desactivar"}</LoadingButton>
        </DialogFooter>
      </form>
    </Dialog>}
  </>;
}
