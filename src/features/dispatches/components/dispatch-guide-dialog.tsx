"use client";

import { PackageOpen, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { notifications } from "@/lib/notification-messages";

import { saveDispatchGuideAction } from "../actions";
import {
  initialDispatchMutationState,
  type DispatchGuide,
  type DispatchUnit,
} from "../types";

type EditableLine = {
  key: string;
  quantity: string;
  unitCode: string;
  productCode: string;
  productDescription: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function DispatchGuideDialog({
  projectId,
  programmingId,
  dispatchId,
  expectedVersion,
  programmedUnitCode,
  units,
  guide,
  onClose,
}: {
  projectId: string;
  programmingId: string;
  dispatchId: string;
  expectedVersion: number;
  programmedUnitCode: string;
  units: DispatchUnit[];
  guide?: DispatchGuide;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    saveDispatchGuideAction,
    initialDispatchMutationState,
  );
  useActionNotification({
    pending,
    status: state.status,
    success: notifications.guideSaved,
    error: notifications.saveFailed,
  });
  const [guideNumber, setGuideNumber] = useState(guide?.guideNumber ?? "");
  const [guideDate, setGuideDate] = useState(guide?.guideDate ?? today());
  const [lines, setLines] = useState<EditableLine[]>(
    guide?.lines.length
      ? guide.lines.map((line) => ({
          key: line.id,
          quantity: String(line.quantity),
          unitCode: line.unitCode,
          productCode: line.productCode,
          productDescription: line.productDescription,
        }))
      : [{
          key: "new-line-1",
          quantity: "",
          unitCode: programmedUnitCode,
          productCode: "",
          productDescription: "",
        }],
  );
  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onClose();
    }
  }, [onClose, router, state.status]);

  const update = (key: string, field: keyof Omit<EditableLine, "key">, value: string) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
  };

  return (
    <Dialog title={guide ? "Editar guía" : "Agregar guía"} description="Cada guía puede contener uno o varios productos." icon={PackageOpen} onClose={onClose} pending={pending} size="lg">
        <form action={action}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="programmingId" value={programmingId} />
          <input type="hidden" name="dispatchId" value={dispatchId} />
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
          <input type="hidden" name="guideId" value={guide?.id ?? ""} />
          <div className="max-h-[calc(92vh-9rem)] space-y-5 overflow-y-auto p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="form-label" htmlFor="guide-number">Número de guía *</label><input id="guide-number" name="guideNumber" required maxLength={120} value={guideNumber} onChange={(event) => setGuideNumber(event.target.value)} className="form-input" /></div>
              <div><label className="form-label" htmlFor="guide-date">Fecha *</label><input id="guide-date" name="guideDate" type="date" required value={guideDate} onChange={(event) => setGuideDate(event.target.value)} className="form-input" /></div>
            </div>
            <div className="rounded-xl border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"><div><h3 className="text-sm font-semibold">Productos</h3><p className="mt-0.5 text-xs text-foreground-muted">Cantidad, UM, código y descripción.</p></div><button type="button" onClick={() => setLines((current) => [...current, { key: crypto.randomUUID(), quantity: "", unitCode: programmedUnitCode, productCode: "", productDescription: "" }])} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted"><Plus className="size-4" /> Agregar producto</button></div>
              <div className="divide-y divide-border">
                {lines.map((line, index) => (
                  <div key={line.key} className="grid gap-3 p-4 md:grid-cols-[7rem_8rem_10rem_minmax(0,1fr)_2.5rem]">
                    <div><label className="form-label" htmlFor={`line-quantity-${line.key}`}>Cantidad *</label><input id={`line-quantity-${line.key}`} name="lineQuantity" type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => update(line.key, "quantity", event.target.value)} className="form-input" /></div>
                    <div><label className="form-label" htmlFor={`line-unit-${line.key}`}>UM *</label><select id={`line-unit-${line.key}`} name="lineUnitCode" required value={line.unitCode} onChange={(event) => update(line.key, "unitCode", event.target.value)} className="form-input">{units.map((unit) => <option key={unit.code} value={unit.code}>{unit.code}</option>)}</select></div>
                    <div><label className="form-label" htmlFor={`line-code-${line.key}`}>Código *</label><input id={`line-code-${line.key}`} name="lineProductCode" required maxLength={120} value={line.productCode} onChange={(event) => update(line.key, "productCode", event.target.value)} className="form-input" /></div>
                    <div><label className="form-label" htmlFor={`line-description-${line.key}`}>Descripción *</label><input id={`line-description-${line.key}`} name="lineProductDescription" required maxLength={500} value={line.productDescription} onChange={(event) => update(line.key, "productDescription", event.target.value)} className="form-input" /></div>
                    <div className="flex items-end"><IconButton label={`Eliminar producto ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} tone="destructive"><Trash2 className="size-4" /></IconButton></div>
                  </div>
                ))}
              </div>
            </div>
            {state.status === "error" && <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive">{state.message}</p>}
          </div>
          <DialogFooter><Button variant="secondary" onClick={onClose} disabled={pending}>Cancelar</Button><LoadingButton loadingLabel="Guardando…">Guardar guía</LoadingButton></DialogFooter>
        </form>
    </Dialog>
  );
}
