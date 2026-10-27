"use client";

import { PackageOpen, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { notifications } from "@/lib/notification-messages";

import { saveDispatchGuideAction } from "../actions";
import { catalogSelectionDefaults } from "../catalog-selection";
import { SERVICE_UNIT_CODES } from "../../platform/project-price-catalogs/service-units";
import { formatDispatchMoney } from "../formatters";
import {
  initialDispatchMutationState,
  type DispatchCatalogOption,
  type DispatchCatalogType,
  type DispatchGuide,
  type DispatchUnit,
} from "../types";
import { DispatchCatalogCombobox } from "./dispatch-catalog-combobox";

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

function truckTime(value: string | null | undefined, timezone: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone,
  }).format(new Date(value));
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
  operationDate,
  timezone = "America/Guatemala",
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
  operationDate?: string;
  timezone?: string;
  guide?: DispatchGuide;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveDispatchGuideAction, initialDispatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.guideSaved, error: notifications.saveFailed });
  const [guideNumber, setGuideNumber] = useState(guide?.guideNumber ?? "");
  const [guideDate, setGuideDate] = useState(guide?.guideDate ?? operationDate ?? today());
  const [truckArrivalTime, setTruckArrivalTime] = useState(truckTime(guide?.truckArrivalAt, timezone));
  const [truckDepartureTime, setTruckDepartureTime] = useState(truckTime(guide?.truckDepartureAt, timezone));
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

  const update = (
    key: string,
    field: keyof Omit<EditableLine, "key" | "unitPrice">,
    value: string,
  ) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
  };
  const selectCatalogItem = (key: string, item: DispatchCatalogOption) => {
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      return {
        ...line,
        catalogType: item.type,
        catalogItemId: item.id,
        productCode: item.code,
        catalogReference: item.reference ?? "",
        ...catalogSelectionDefaults(item, line, programmedUnitCode),
        unitPrice: item.price,
        currency: item.currency,
      };
    }));
  };

  const productCount = lines.filter((line) => line.catalogType === "PRODUCT").length;
  const serviceCount = lines.filter((line) => line.catalogType === "SERVICE").length;
  const estimate = (type: DispatchCatalogType) => lines.reduce((total, line) =>
    line.catalogType === type && line.unitPrice !== null && Number.isFinite(Number(line.quantity))
      ? total + line.unitPrice * Number(line.quantity) : total, 0);
  const addLine = () => setLines((current) => [...current, emptyLine(crypto.randomUUID())]);

  return (
    <Dialog title={guide ? (readOnly ? "Ver guía" : "Editar guía") : "Agregar guía"} description="Registra los horarios del camión y cada producto o servicio de esta guía." icon={PackageOpen} onClose={onClose} pending={pending} size="xl">
      <form className="dispatch-guide-form" onSubmit={(event) => {
        event.preventDefault();
        // Retain every controlled field when the action returns a validation
        // error. Native form-action resets can clear the visible service unit.
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="programmingId" value={programmingId} />
        <input type="hidden" name="dispatchId" value={dispatchId} />
        <input type="hidden" name="expectedVersion" value={expectedVersion} />
        <input type="hidden" name="guideId" value={guide?.id ?? ""} />
        <div className="space-y-5 p-4 sm:p-6">
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0"><label className="form-label" htmlFor="guide-number">Número de guía *</label><input id="guide-number" name="guideNumber" required maxLength={120} value={guideNumber} onChange={(event) => setGuideNumber(event.target.value)} disabled={readOnly || pending} className="form-input min-w-0 disabled:bg-muted" /></div>
            <div className="min-w-0"><label className="form-label" htmlFor="guide-date">Fecha *</label><input id="guide-date" name="guideDate" type="date" required value={guideDate} onChange={(event) => setGuideDate(event.target.value)} disabled={readOnly || pending} className="form-input min-w-0 disabled:bg-muted" /></div>
            <div className="min-w-0"><label className="form-label" htmlFor="guide-truck-arrival">Llegada del camión *</label><input id="guide-truck-arrival" name="truckArrivalTime" type="time" required value={truckArrivalTime} onChange={(event) => setTruckArrivalTime(event.target.value)} disabled={readOnly || pending} className="form-input min-w-0 disabled:bg-muted" /></div>
            <div className="min-w-0"><label className="form-label" htmlFor="guide-truck-departure">Salida del camión *</label><input id="guide-truck-departure" name="truckDepartureTime" type="time" required min={truckArrivalTime || undefined} value={truckDepartureTime} onChange={(event) => setTruckDepartureTime(event.target.value)} disabled={readOnly || pending} className="form-input min-w-0 disabled:bg-muted" /></div>
          </div>
          <p className="text-xs leading-5 text-foreground-muted">Horarios del camión en el día de la programación, independientes de la hora de inicio del despacho. La salida del despacho toma la salida más tardía de sus guías.</p>
          <section className="space-y-3" aria-labelledby="guide-lines-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 id="guide-lines-heading" className="font-semibold">Productos y servicios</h3><p className="mt-1 text-xs text-foreground-muted">{productCount} producto(s) · {serviceCount} servicio(s). El precio se guarda como histórico.</p></div>
              {!readOnly && <button type="button" onClick={addLine} disabled={pending} className="secondary-button guide-add-desktop min-h-11 gap-2"><Plus aria-hidden="true" className="size-4" /> Agregar producto / servicio</button>}
            </div>
            {serviceCount > 0 && productCount === 0 && <p role="status" className="text-xs text-foreground-muted">Guía de servicios: sus cantidades no suman volumen de concreto.</p>}
            {lines.length === 0 && <p className="rounded-xl border border-dashed border-border p-5 text-sm text-foreground-muted" role="status">Sin líneas. Agrega un producto o servicio para continuar.</p>}
            {lines.map((line, index) => {
              const parsedQuantity = Number(line.quantity);
              const subtotal = line.unitPrice === null || !Number.isFinite(parsedQuantity) ? null : line.unitPrice * parsedQuantity;
              const selectionLabel = line.catalogType === "PRODUCT"
                ? `${line.productCode}${line.catalogReference ? ` · ${line.catalogReference}` : ""}`
                : line.productCode || (line.lineId ? "Línea histórica sin catálogo" : "");
              const kind = line.catalogType === "PRODUCT" ? "Producto" : line.catalogType === "SERVICE" ? "Servicio" : "Producto o servicio";
              return (
                <article key={line.key} className="min-w-0 rounded-xl border border-border bg-surface shadow-sm" aria-labelledby={`line-title-${line.key}`}>
                  <div className="flex items-center justify-between gap-3 rounded-t-xl border-b border-border bg-muted/50 px-3 py-2 sm:px-4 lg:py-1">
                    <h4 id={`line-title-${line.key}`} className="flex min-w-0 items-center gap-2 text-sm font-semibold"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-foreground-muted">{index + 1}</span>{kind}</h4>
                    {!readOnly && <IconButton label={`Eliminar línea ${index + 1}`} disabled={pending} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} tone="destructive"><Trash2 aria-hidden="true" className="size-4" /></IconButton>}
                  </div>
                  <div className="guide-line-fields grid min-w-0 gap-4 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-[5.5rem_5.25rem_minmax(15rem,1.35fr)_minmax(10rem,1fr)_8rem] lg:items-start lg:gap-3">
                    <input type="hidden" name="lineId" value={line.lineId} />
                    <input type="hidden" name="lineUnitCode" value={line.unitCode} />
                    <input type="hidden" name="lineCatalogType" value={line.catalogType} />
                    <input type="hidden" name="lineCatalogItemId" value={line.catalogItemId} />
                    <input type="hidden" name="lineProductDescription" value={line.productDescription} />
                    <div className="min-w-0 sm:col-span-2 lg:order-3 lg:col-span-1"><label className="form-label" htmlFor={`line-catalog-${line.key}`}>Buscar producto o servicio *</label><DispatchCatalogCombobox id={`line-catalog-${line.key}`} projectId={projectId} value={selectionLabel} selectedId={line.catalogItemId} productUnitCode={programmedUnitCode} disabled={readOnly || pending} onSelect={(item) => selectCatalogItem(line.key, item)} /></div>
                    <div className="grid min-w-0 grid-cols-2 gap-3 lg:contents">
                      <div className="min-w-0 lg:order-1"><label className="form-label" htmlFor={`line-quantity-${line.key}`}>Cantidad *</label><input id={`line-quantity-${line.key}`} name="lineQuantity" type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => update(line.key, "quantity", event.target.value)} disabled={readOnly || pending} className="form-input min-w-0 disabled:bg-muted" /></div>
                      <div className="min-w-0 lg:order-2"><label className="form-label" htmlFor={`line-unit-${line.key}`}>UM *</label><select id={`line-unit-${line.key}`} required value={line.unitCode} onChange={(event) => update(line.key, "unitCode", event.target.value)} disabled={readOnly || pending || line.catalogType === "PRODUCT" || (!line.catalogType && Boolean(line.lineId))} className="form-input min-w-0 disabled:bg-muted"><option value="">Selecciona</option>{Array.from(new Set([...(line.catalogType === "SERVICE" ? SERVICE_UNIT_CODES : units.map((unit) => unit.code)), ...(line.unitCode ? [line.unitCode] : [])])).map((code) => <option key={code} value={code}>{code}</option>)}</select></div>
                    </div>
                    <div className="min-w-0 lg:order-4"><label className="form-label" htmlFor={`line-description-${line.key}`}>{line.catalogType === "PRODUCT" ? "Referencia" : "Descripción"}</label><textarea id={`line-description-${line.key}`} rows={2} maxLength={500} value={line.productDescription} title={line.productDescription || undefined} onChange={(event) => update(line.key, "productDescription", event.target.value)} disabled={readOnly || pending || line.catalogType !== "SERVICE"} placeholder="Se completa al seleccionar" className="form-input min-w-0 resize-y disabled:bg-muted" /></div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm sm:col-span-2 lg:order-5 lg:col-span-1 lg:flex-col lg:items-start lg:justify-start lg:gap-1 lg:border-t-0 lg:pt-0"><p className="text-xs text-foreground-muted lg:order-2">{line.unitPrice !== null && line.currency ? `${formatDispatchMoney(line.unitPrice, line.currency)} c/u` : "Selecciona un registro del catálogo"}</p><p className="font-semibold lg:order-1"><span className="lg:hidden">Estimado: </span><span className="hidden text-sm font-medium lg:mb-2 lg:block">Estimado</span>{subtotal === null || !line.currency ? "No disponible" : formatDispatchMoney(subtotal, line.currency)}</p></div>
                  </div>
                </article>
              );
            })}
            {!readOnly && <button type="button" onClick={addLine} disabled={pending} className="secondary-button guide-add-mobile min-h-11 w-full gap-2 border-dashed"><Plus aria-hidden="true" className="size-4" /> Agregar producto / servicio</button>}
            <div className="grid gap-3 rounded-xl bg-muted/50 p-3 text-sm sm:grid-cols-2 sm:p-4">
              <p className="flex flex-wrap justify-between gap-2"><span className="text-foreground-muted">Productos</span><strong>{formatDispatchMoney(estimate("PRODUCT"), "GTQ")}</strong></p>
              <p className="flex flex-wrap justify-between gap-2"><span className="text-foreground-muted">Servicios</span><strong>{formatDispatchMoney(estimate("SERVICE"), "GTQ")}</strong></p>
            </div>
          </section>
          {state.status === "error" && <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive">{state.message}</p>}
        </div>
        <DialogFooter><Button variant="secondary" onClick={onClose} disabled={pending}>{readOnly ? "Cerrar" : "Cancelar"}</Button>{!readOnly && <LoadingButton loading={pending} loadingLabel="Guardando…" disabled={lines.length === 0 || lines.some((line) => !line.catalogItemId && !line.lineId)}>Guardar guía</LoadingButton>}</DialogFooter>
      </form>
    </Dialog>
  );
}
