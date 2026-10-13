"use client";

import { PackageOpen, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { notifications } from "@/lib/notification-messages";

import { saveDispatchGuideAction } from "../actions";
import { formatDispatchMoney } from "../formatters";
import {
  initialDispatchMutationState,
  type DispatchCatalogOption,
  type DispatchCatalogType,
  type DispatchGuide,
  type DispatchUnit,
} from "../types";
import { DispatchCatalogPickerDialog } from "./dispatch-catalog-picker-dialog";

type EditableLine = {
  key: string;
  lineId: string;
  quantity: string;
  unitCode: string;
  catalogType: DispatchCatalogType | "";
  catalogItemId: string;
  productCode: string;
  catalogReference: string;
  productDescription: string;
  unitPrice: number | null;
  currency: string;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function emptyLine(key: string, unitCode = ""): EditableLine {
  return {
    key,
    lineId: "",
    quantity: "",
    unitCode,
    catalogType: "",
    catalogItemId: "",
    productCode: "",
    catalogReference: "",
    productDescription: "",
    unitPrice: null,
    currency: "",
  };
}

function initialLine(
  programmedUnitCode: string,
  defaultDescription: string,
  defaultProduct: DispatchCatalogOption | null,
): EditableLine {
  if (!defaultProduct) {
    return {
      ...emptyLine("new-line-1", programmedUnitCode),
      productDescription: defaultDescription,
    };
  }
  return {
    ...emptyLine("new-line-1", programmedUnitCode),
    catalogType: "PRODUCT",
    catalogItemId: defaultProduct.id,
    productCode: defaultProduct.code,
    catalogReference: defaultProduct.reference ?? "",
    productDescription: defaultProduct.reference ?? defaultDescription,
    unitPrice: defaultProduct.price,
    currency: defaultProduct.currency,
  };
}

export function DispatchGuideDialog({
  projectId,
  programmingId,
  dispatchId,
  expectedVersion,
  programmedUnitCode,
  defaultProductDescription,
  defaultCatalogProduct = null,
  units,
  guide,
  readOnly = false,
  onClose,
}: {
  projectId: string;
  programmingId: string;
  dispatchId: string;
  expectedVersion: number;
  programmedUnitCode: string;
  defaultProductDescription?: string | null;
  defaultCatalogProduct?: DispatchCatalogOption | null;
  units: DispatchUnit[];
  guide?: DispatchGuide;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveDispatchGuideAction, initialDispatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.guideSaved, error: notifications.saveFailed });
  const [guideNumber, setGuideNumber] = useState(guide?.guideNumber ?? "");
  const [guideDate, setGuideDate] = useState(guide?.guideDate ?? today());
  const [pickerLineKey, setPickerLineKey] = useState<string | null>(null);
  const [lines, setLines] = useState<EditableLine[]>(
    guide?.lines.length
      ? guide.lines.map((line) => ({
          key: line.id,
          lineId: line.id,
          quantity: String(line.quantity),
          unitCode: line.unitCode,
          catalogType: line.catalogType ?? "",
          catalogItemId: line.catalogItemId ?? "",
          productCode: line.productCode ?? "",
          catalogReference: line.catalogReference ?? "",
          productDescription: line.productDescription ?? "",
          unitPrice: line.unitPrice,
          currency: line.currency ?? "",
        }))
      : [initialLine(programmedUnitCode, defaultProductDescription ?? "", defaultCatalogProduct)],
  );

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
      onClose();
    }
  }, [onClose, router, state.status]);

  const pickerLine = useMemo(
    () => lines.find((line) => line.key === pickerLineKey) ?? null,
    [lines, pickerLineKey],
  );
  const update = (
    key: string,
    field: keyof Omit<EditableLine, "key" | "unitPrice">,
    value: string,
  ) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
  };
  const selectCatalogItem = (item: DispatchCatalogOption) => {
    if (!pickerLineKey) return;
    setLines((current) => current.map((line) => {
      if (line.key !== pickerLineKey) return line;
      return {
        ...line,
        catalogType: item.type,
        catalogItemId: item.id,
        productCode: item.code,
        catalogReference: item.reference ?? "",
        productDescription: item.type === "PRODUCT"
          ? item.reference ?? ""
          : line.catalogType === "PRODUCT" ? "" : line.productDescription,
        unitCode: item.type === "PRODUCT" ? programmedUnitCode : line.unitCode,
        unitPrice: item.price,
        currency: item.currency,
      };
    }));
    setPickerLineKey(null);
  };

  return (
    <>
      <Dialog title={guide ? (readOnly ? "Ver guía" : "Editar guía") : "Agregar guía"} description="Cada guía registra productos y servicios del catálogo del proyecto." icon={PackageOpen} onClose={onClose} pending={pending || Boolean(pickerLineKey)} size="xl">
        <form action={action}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="programmingId" value={programmingId} />
          <input type="hidden" name="dispatchId" value={dispatchId} />
          <input type="hidden" name="expectedVersion" value={expectedVersion} />
          <input type="hidden" name="guideId" value={guide?.id ?? ""} />
          <div className="max-h-[calc(92vh-9rem)] space-y-5 overflow-y-auto p-4 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="form-label" htmlFor="guide-number">Número de guía *</label><input id="guide-number" name="guideNumber" required maxLength={120} value={guideNumber} onChange={(event) => setGuideNumber(event.target.value)} disabled={readOnly} className="form-input disabled:bg-muted" /></div>
              <div><label className="form-label" htmlFor="guide-date">Fecha *</label><input id="guide-date" name="guideDate" type="date" required value={guideDate} onChange={(event) => setGuideDate(event.target.value)} disabled={readOnly} className="form-input disabled:bg-muted" /></div>
            </div>
            <div className="rounded-xl border border-border">
              <div className="flex flex-col gap-3 border-b border-border px-4 py-3 min-[460px]:flex-row min-[460px]:items-center min-[460px]:justify-between">
                <div><h3 className="text-sm font-semibold">Productos y servicios</h3><p className="mt-0.5 text-xs text-foreground-muted">El precio se toma del catálogo y queda guardado como histórico.</p></div>
                {!readOnly && <button type="button" onClick={() => setLines((current) => [...current, emptyLine(crypto.randomUUID())])} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted min-[460px]:min-h-9 min-[460px]:w-auto"><Plus className="size-4" /> Agregar producto / servicio</button>}
              </div>
              <div className="divide-y divide-border">
                {lines.map((line, index) => {
                  const parsedQuantity = Number(line.quantity);
                  const subtotal = line.unitPrice === null || !Number.isFinite(parsedQuantity) ? null : line.unitPrice * parsedQuantity;
                  const selectionLabel = line.catalogType === "PRODUCT"
                    ? `${line.productCode}${line.catalogReference ? ` · ${line.catalogReference}` : ""}`
                    : line.catalogType === "SERVICE"
                      ? line.productCode
                      : line.lineId ? "Sin catálogo (línea histórica)" : "Seleccionar del catálogo";
                  return (
                    <div key={line.key} className="grid gap-3 p-4 md:grid-cols-[7rem_7rem_minmax(13rem,1.15fr)_minmax(11rem,1fr)_8rem_2.5rem]">
                      <input type="hidden" name="lineId" value={line.lineId} />
                      <input type="hidden" name="lineUnitCode" value={line.unitCode} />
                      <input type="hidden" name="lineCatalogType" value={line.catalogType} />
                      <input type="hidden" name="lineCatalogItemId" value={line.catalogItemId} />
                      <input type="hidden" name="lineProductDescription" value={line.productDescription} />
                      <div><label className="form-label" htmlFor={`line-quantity-${line.key}`}>Cantidad *</label><input id={`line-quantity-${line.key}`} name="lineQuantity" type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => update(line.key, "quantity", event.target.value)} disabled={readOnly} className="form-input disabled:bg-muted" /></div>
                      <div><label className="form-label" htmlFor={`line-unit-${line.key}`}>UM *</label><select id={`line-unit-${line.key}`} required value={line.unitCode} onChange={(event) => update(line.key, "unitCode", event.target.value)} disabled={readOnly || line.catalogType === "PRODUCT" || (!line.catalogType && Boolean(line.lineId))} className="form-input disabled:bg-muted"><option value="">—</option>{units.map((unit) => <option key={unit.code} value={unit.code}>{unit.code}</option>)}</select></div>
                      <div><p className="form-label">Código *</p><button type="button" onClick={() => setPickerLineKey(line.key)} disabled={readOnly} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 text-left text-sm disabled:bg-muted"><span className={line.productCode || line.lineId ? "font-medium" : "text-foreground-muted"}>{selectionLabel}</span>{!readOnly && <Search className="size-4 shrink-0 text-foreground-muted" />}</button></div>
                      <div><label className="form-label" htmlFor={`line-description-${line.key}`}>{line.catalogType === "PRODUCT" ? "Referencia" : "Descripción"}</label><input id={`line-description-${line.key}`} maxLength={500} value={line.productDescription} onChange={(event) => update(line.key, "productDescription", event.target.value)} disabled={readOnly || line.catalogType !== "SERVICE"} placeholder={line.catalogType === "SERVICE" ? "Opcional" : "Se completa desde el catálogo"} className="form-input disabled:bg-muted" /></div>
                      <div><p className="form-label">Estimado</p><p className="mt-2 whitespace-nowrap text-sm font-semibold">{subtotal === null || !line.currency ? "No disponible" : formatDispatchMoney(subtotal, line.currency)}</p>{line.unitPrice !== null && line.currency && <p className="mt-1 text-[11px] text-foreground-muted">{formatDispatchMoney(line.unitPrice, line.currency)} c/u</p>}</div>
                      <div className="flex items-end justify-end"><IconButton label={`Eliminar línea ${index + 1}`} disabled={readOnly || lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} tone="destructive"><Trash2 className="size-4" /></IconButton></div>
                    </div>
                  );
                })}
              </div>
            </div>
            {state.status === "error" && <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive">{state.message}</p>}
          </div>
          <DialogFooter><Button variant="secondary" onClick={onClose} disabled={pending}>{readOnly ? "Cerrar" : "Cancelar"}</Button>{!readOnly && <LoadingButton loadingLabel="Guardando…">Guardar guía</LoadingButton>}</DialogFooter>
        </form>
      </Dialog>
      {pickerLine && <DispatchCatalogPickerDialog projectId={projectId} initialType={pickerLine.catalogType === "SERVICE" ? "SERVICE" : "PRODUCT"} onSelect={selectCatalogItem} onClose={() => setPickerLineKey(null)} />}
    </>
  );
}
