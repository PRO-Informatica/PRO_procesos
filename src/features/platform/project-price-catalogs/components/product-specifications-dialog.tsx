"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { LoadingButton } from "@/components/feedback/loading-button";
import { updateProductSpecificationsAction } from "../actions";
import type { ProjectProductPrice } from "../types";

export function ProductSpecificationsDialog({ companyId, projectId, product }: { companyId: string; projectId: string; product: ProjectProductPrice }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function close() { if (!pending) setOpen(false); }
  return <>
    <Button variant="secondary" onClick={() => { setError(null); setOpen(true); }} aria-label={`Editar especificaciones de ${product.code} ${product.reference}`}>Editar</Button>
    {open && <Dialog title="Especificaciones del concreto" description={`${product.code} · ${product.reference}`} onClose={close} pending={pending}>
      <form action={(data) => startTransition(async () => {
        setError(null);
        const result = await updateProductSpecificationsAction(data);
        if (result.status === "error") { setError(result.message); return; }
        setOpen(false);
        router.refresh();
      })}>
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="updatedAt" value={product.updatedAt} />
        <div className="space-y-4 p-4 sm:p-6">
          <label className="block"><span className="form-label">Resistencia PSI (28 días)</span><input name="resistancePsi" type="number" min="1" max="99999" step="1" defaultValue={product.resistancePsi ?? ""} placeholder="Ej. 4000" className="form-input" disabled={pending} /></label>
          <label className="block"><span className="form-label">Slump en obra (pulgadas)</span><input name="slump" maxLength={120} defaultValue={product.slump ?? ""} placeholder={'Ej. 3 +/- 1"'} className="form-input" disabled={pending} /></label>
          <p className="text-sm text-foreground-muted">Puedes dejar estos campos vacíos si no están definidos en la cotización.</p>
          {error && <p role="alert" className="rounded-lg bg-destructive-soft p-3 text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter><Button type="button" variant="secondary" onClick={close} disabled={pending}>Cancelar</Button><LoadingButton type="submit" loading={pending} loadingLabel="Guardando…">Guardar</LoadingButton></DialogFooter>
      </form>
    </Dialog>}
  </>;
}
