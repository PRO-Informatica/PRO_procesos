"use client";

import { Power, PowerOff } from "lucide-react";
import { motion } from "motion/react";
import { useActionState, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { notifications } from "@/lib/notification-messages";

import { setCompanyStatus } from "../actions";
import { initialCompanyActionState, type CompanyStatus } from "../types";

export function CompanyStatusDialog({ companyId, companyName, status, returnTo, compact = false }: {
  companyId: string;
  companyName: string;
  status: CompanyStatus;
  returnTo: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(setCompanyStatus, initialCompanyActionState);
  const activating = status === "INACTIVE";
  useActionNotification({ pending, status: state.status, success: notifications.statusUpdated, error: notifications.actionFailed });

  return <>
    <motion.button type="button" onClick={() => setOpen(true)} className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${activating ? "border-success/25 text-success hover:bg-success-soft" : "border-border text-foreground-muted hover:bg-muted hover:text-foreground"}`} whileTap={{ scale: 0.98 }} aria-label={`${activating ? "Activar" : "Desactivar"} ${companyName}`}>
      {activating ? <Power aria-hidden="true" className="size-3.5" /> : <PowerOff aria-hidden="true" className="size-3.5" />}
      {!compact && (activating ? "Activar" : "Desactivar")}
    </motion.button>
    {open && <Dialog title={activating ? "Reactivar empresa" : "Desactivar empresa"} description={activating ? `${companyName} volverá a quedar activa.` : `${companyName} quedará inactiva sin eliminar su información.`} icon={activating ? Power : PowerOff} onClose={() => setOpen(false)} pending={pending} tone={activating ? "default" : "destructive"} size="sm">
      <form action={formAction}>
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="active" value={String(activating)} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="p-5 sm:p-6">
          <p className="text-sm leading-6 text-foreground-muted">{activating ? "La empresa recuperará su acceso global." : "Sus proyectos, usuarios e historial se conservarán."}</p>
          {state.status === "error" && <p className="mt-4 rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive" role="alert">{state.message}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
          <LoadingButton loadingLabel={activating ? "Reactivando…" : "Desactivando…"} variant={activating ? "primary" : "destructive"}>{activating ? "Reactivar" : "Desactivar"}</LoadingButton>
        </DialogFooter>
      </form>
    </Dialog>}
  </>;
}
