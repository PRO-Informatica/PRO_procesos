"use client";

import { PackageOpen, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useActionNotification } from "@/components/feedback/use-action-notification";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { notifications } from "@/lib/notification-messages";
import { getPublicEnvironment } from "@/lib/env";
import { GuidePhotoCapture, guideCaptureUrl, type GuidePhotoResult, type GuidePhotoCaptureHandle } from "@/features/vision-ocr/components/guide-photo-capture";
import { GuideOcrVariants, SavedGuideOcrDetails } from "@/features/vision-ocr/components/guide-ocr-details";
import { type GuideDetails, type GuideOcrDraft } from "@/features/vision-ocr/guide-draft";

import { GuideOcrReview } from "@/features/vision-ocr/components/guide-ocr-review";
import { emptyGuideDetails } from "../guide-details";

import { saveDispatchGuideAction } from "../actions";
import { catalogSelectionDefaults } from "../catalog-selection";
import { SERVICE_UNIT_CODES } from "../../platform/project-price-catalogs/service-units";
import { formatDispatchMoney } from "../formatters";
import {
  initialDispatchMutationState,
  type DispatchMutationState,
  type DispatchCatalogOption,
  type DispatchCatalogType,
  type DispatchGuide,
  type DispatchUnit,
} from "../types";
import { GuideResidentFields } from "./guide-resident-fields";
import { GuideLinesList } from "./guide-lines-list";
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
  ocrCandidates?: DispatchCatalogOption[];
  ocrWarning?: string | null;
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
  const guideNumberRef = useRef<HTMLInputElement>(null);
  const handledResult = useRef<DispatchMutationState | null>(null);
  const [savedVersion, setSavedVersion] = useState(expectedVersion);
  const [guideNumber, setGuideNumber] = useState(guide?.guideNumber ?? "");
  const [castingElement, setCastingElement] = useState(guide?.castingElement ?? "");
  const [laboratoryApplied, setLaboratoryApplied] = useState(guide?.laboratoryApplied ?? false);
  const [guideDate, setGuideDate] = useState(guide?.guideDate ?? operationDate ?? today());
  const [truckArrivalTime, setTruckArrivalTime] = useState(truckTime(guide?.truckArrivalAt, timezone));
  const [truckDepartureTime, setTruckDepartureTime] = useState(truckTime(guide?.truckDepartureAt, timezone));
  const ocrEnabled = getPublicEnvironment().appEnvironment === "DEV";
  const [capture, setCapture] = useState<GuidePhotoResult | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoSelected, setPhotoSelected] = useState(false);
  const [ocrReviewed, setOcrReviewed] = useState(false);
  const [photoRetryGuide, setPhotoRetryGuide] = useState<string | null>(null);
  const photoCaptureRef = useRef<GuidePhotoCaptureHandle>(null);
  const [details, setDetails] = useState<GuideDetails>(() => ({ ...emptyGuideDetails(), ...guide?.details }));
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
  const [confirmClose, setConfirmClose] = useState(false);
  const editSnapshot = JSON.stringify({ guideNumber, guideDate, truckArrivalTime, truckDepartureTime, castingElement, laboratoryApplied, details, lines });
  const [initialEditSnapshot] = useState(editSnapshot);
  const hasUnsavedChanges = Boolean(guide && !readOnly && editSnapshot !== initialEditSnapshot);
  const removedLineCount = guide?.lines.filter((savedLine) => !lines.some((line) => line.lineId === savedLine.id)).length ?? 0;
  const requestClose = () => {
    if (hasUnsavedChanges) setConfirmClose(true);
    else onClose();
  };
  const beforeClose = () => {
    if (confirmClose) { setConfirmClose(false); return false; }
    if (hasUnsavedChanges) { setConfirmClose(true); return false; }
    return true;
  };
  const [state, action, pending] = useActionState(async (previous: DispatchMutationState, data: FormData) => {
    let result: DispatchMutationState;
    if (capture && details && !guide && ocrEnabled) {
      const draft: GuideOcrDraft = { ...capture.draft, guideNumber, arrivalTime: truckArrivalTime, departureTime: truckDepartureTime,
        resident: { castingElement, laboratoryApplied }, details: { ...details, guideDate }, lines: lines.map((line) => ({ quantity: line.quantity, unit: line.unitCode, productCode: line.productCode,
          description: line.productDescription, type: line.catalogType, catalogItemId: line.catalogItemId, candidates: [], warning: null })) };
      try {
        const response = await fetch(guideCaptureUrl(projectId, dispatchId), { method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ captureId: capture.captureId, draft, expectedVersion: Math.max(expectedVersion, savedVersion), reviewed: ocrReviewed }) });
        const payload = await response.json();
        if (!response.ok) {
          if (payload.guideId) setPhotoRetryGuide(payload.guideId);
          result = { status: "error", message: payload.error || "No se pudo guardar la guía." };
        } else result = { status: "success", guideId: payload.guideId, newVersion: payload.newVersion, message: "Guía y foto guardadas." };
      } catch { setPhotoRetryGuide("pending-response"); result = { status: "error", message: "Se perdió la conexión. Reintenta guardar esta captura; no se duplicará la guía." }; }
    } else result = await saveDispatchGuideAction(previous, data);
    if (result.status === "success" && !guide) {
      if (result.newVersion !== undefined) setSavedVersion(result.newVersion);
      setGuideNumber(""); setCastingElement(""); setLaboratoryApplied(false);
      setTruckArrivalTime("");
      setTruckDepartureTime("");
      setCapture(null); setDetails(emptyGuideDetails()); setPhotoSelected(false); setOcrReviewed(false); setPhotoRetryGuide(null);
      // A fresh key also clears the catalog search draft for the next guide.
      setLines([{
        ...initialLine(programmedUnitCode, defaultProductDescription ?? "", defaultCatalogProduct),
        key: `new-line-${result.guideId ?? result.newVersion}`,
      }]);
      if (capture) photoCaptureRef.current?.saved();
    }
    return result;
  }, initialDispatchMutationState);
  useActionNotification({ pending, status: state.status, success: notifications.guideSaved, error: notifications.saveFailed });

  useEffect(() => {
    if (pending || state.status !== "success" || handledResult.current === state) return;
    handledResult.current = state;
    router.refresh();
    if (guide) onClose();
    else if (!photoCaptureRef.current?.focusPending()) {
      guideNumberRef.current?.focus();
      guideNumberRef.current?.scrollIntoView({ block: "center" });
    }
  }, [guide, onClose, pending, router, state]);

  useEffect(() => {
    if (!capture) return;
    const frame = requestAnimationFrame(() => {
      guideNumberRef.current?.focus({ preventScroll: true });
      document.getElementById("ocr-review-heading")?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [capture]);

  const update = (
    key: string,
    field: keyof Omit<EditableLine, "key" | "unitPrice">,
    value: string,
  ) => {
    setOcrReviewed(false);
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value, ...(field === "productCode" ? { ocrCandidates: [], ocrWarning: null } : {}) } : line));
  };
  const selectCatalogItem = (key: string, item: DispatchCatalogOption) => {
    setOcrReviewed(false);
    setLines((current) => current.map((line) => {
      if (line.key !== key) return line;
      return {
        ...line,
        catalogType: item.type,
        catalogItemId: item.id,
        productCode: item.code,
        catalogReference: item.reference ?? "",
        ...catalogSelectionDefaults(item, line, programmedUnitCode),
        ...(capture && !line.unitCode ? { unitCode: "" } : {}),
        unitPrice: item.price,
        currency: item.currency,
      };
    }));
  };

  const productCount = lines.filter((line) => line.catalogType === "PRODUCT").length;
  const serviceCount = lines.filter((line) => line.catalogType === "SERVICE").length;
  const addLine = () => { setOcrReviewed(false); setLines((current) => [...current, emptyLine(crypto.randomUUID())]); };
  const locked = readOnly || pending || photoBusy || Boolean(photoRetryGuide) || (photoSelected && !capture);
  const applyCapture = (result: GuidePhotoResult) => {
    setCapture(result); setDetails(result.draft.details); setOcrReviewed(false);
    setCastingElement(""); setLaboratoryApplied(false);
    setGuideNumber(result.draft.guideNumber); setGuideDate(result.draft.details.guideDate);
    setTruckArrivalTime(result.draft.arrivalTime); setTruckDepartureTime(result.draft.departureTime);
    setLines(result.draft.lines.length ? result.draft.lines.map((line) => {
      const selected = line.candidates.find((item) => item.id === line.catalogItemId);
      return { ...emptyLine(crypto.randomUUID()), quantity: line.quantity, unitCode: line.unit, catalogType: line.type,
        catalogItemId: line.catalogItemId, productCode: line.productCode, productDescription: line.description,
        catalogReference: selected?.reference ?? "", unitPrice: selected?.price ?? null, currency: selected?.currency ?? "",
        ocrCandidates: line.candidates, ocrWarning: line.warning };
    }) : [emptyLine(crypto.randomUUID())]);
  };

  const numberField = <div className="min-w-0"><label className="form-label" htmlFor="guide-number">Número de guía *</label><input ref={guideNumberRef} id="guide-number" name="guideNumber" required maxLength={120} value={guideNumber} onChange={(event) => { setGuideNumber(event.target.value); setOcrReviewed(false); }} disabled={locked} className="form-input min-w-0 disabled:bg-muted" /></div>;
  const dateField = <div className="min-w-0"><label className="form-label" htmlFor="guide-date">Fecha *</label><input id="guide-date" name="guideDate" type="date" required value={guideDate} onChange={(event) => { setGuideDate(event.target.value); setOcrReviewed(false); }} disabled={locked} className="form-input min-w-0 disabled:bg-muted" /></div>;
  const arrivalField = <div className="min-w-0"><label className="form-label" htmlFor="guide-truck-arrival">Llegada del camión *</label><input id="guide-truck-arrival" name="truckArrivalTime" type="time" required value={truckArrivalTime} onChange={(event) => { setTruckArrivalTime(event.target.value); setOcrReviewed(false); }} disabled={locked} className="form-input min-w-0 disabled:bg-muted" /></div>;
  const departureField = <div className="min-w-0"><label className="form-label" htmlFor="guide-truck-departure">Salida del camión *</label><input id="guide-truck-departure" name="truckDepartureTime" type="time" required value={truckDepartureTime} onChange={(event) => { setTruckDepartureTime(event.target.value); setOcrReviewed(false); }} disabled={locked} className="form-input min-w-0 disabled:bg-muted" /></div>;
  const timeHint = <>
<p className="text-xs leading-5 text-foreground-muted">La fecha de la guía corresponde a la llegada del camión. Si la hora de salida es menor que la de llegada, se registra al día siguiente. Los horarios son independientes del inicio del despacho.</p>
          {truckArrivalTime && truckDepartureTime && truckDepartureTime < truckArrivalTime && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-xs text-foreground">El camión sale al día siguiente de la fecha de la guía.</p>}
  </>;
  const residentFields = <GuideResidentFields element={castingElement} laboratory={laboratoryApplied} disabled={locked} onElement={(value) => { setCastingElement(value); setOcrReviewed(false); }} onLaboratory={(value) => { setLaboratoryApplied(value); setOcrReviewed(false); }} />;
  const warnings = capture?.draft.warnings.filter((warning) => !/^Línea \d+: confirma la UM/u.test(warning)) ?? [];
  const lineEditor = (
<section className="space-y-3" aria-labelledby="guide-lines-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 id="guide-lines-heading" className="font-semibold">Productos y servicios</h3><p className="mt-1 text-xs text-foreground-muted">{productCount} producto(s) · {serviceCount} servicio(s). El precio se guarda como histórico.</p></div>
              {!readOnly && <button type="button" onClick={addLine} disabled={locked} className="secondary-button guide-add-desktop min-h-11 gap-2"><Plus aria-hidden="true" className="size-4" /> Agregar producto / servicio</button>}
            </div>
            {serviceCount > 0 && productCount === 0 && <p role="status" className="text-xs text-foreground-muted">Guía de servicios: sus cantidades no suman volumen de concreto.</p>}
            {removedLineCount > 0 && <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">{removedLineCount === 1 ? "Una línea se eliminará" : `${removedLineCount} líneas se eliminarán`} al guardar la guía. Pulsa Guardar guía para confirmar.</p>}
            {lines.length === 0 && <p className="rounded-xl border border-dashed border-border p-5 text-sm text-foreground-muted" role="status">Sin líneas. Agrega un producto o servicio para continuar.</p>}
            <GuideLinesList count={lines.length}>{lines.map((line, index) => {
              const parsedQuantity = Number(line.quantity);
              const subtotal = line.unitPrice === null || !Number.isFinite(parsedQuantity) ? null : line.unitPrice * parsedQuantity;
              const selectionLabel = line.catalogType === "PRODUCT"
                ? `${line.productCode}${line.catalogReference ? ` · ${line.catalogReference}` : ""}`
                : line.productCode || (line.lineId ? "Línea histórica sin cotización" : "");
              const kind = line.catalogType === "PRODUCT" ? "Producto" : line.catalogType === "SERVICE" ? "Servicio" : "Producto o servicio";
              return (
                <article key={line.key} className="min-w-0 rounded-xl border border-border bg-surface shadow-sm" aria-labelledby={`line-title-${line.key}`}>
                  <div className="flex items-center justify-between gap-3 rounded-t-xl border-b border-border bg-muted/50 px-3 py-2 sm:px-4 lg:py-1">
                    <h4 id={`line-title-${line.key}`} className="flex min-w-0 items-center gap-2 text-sm font-semibold"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-surface text-foreground-muted">{index + 1}</span>{kind}</h4>
                    {!readOnly && <IconButton label={`Eliminar línea ${index + 1}`} disabled={locked} onClick={() => { setOcrReviewed(false); setLines((current) => current.filter((item) => item.key !== line.key)); }} tone="destructive"><Trash2 aria-hidden="true" className="size-4" /></IconButton>}
                  </div>
                  {capture && !line.catalogItemId && <div className="space-y-3 border-b border-border bg-amber-50 p-3 text-amber-950 sm:px-4">
                    <p role="status" className="text-sm">{line.ocrWarning || "Sin precio seleccionado en la cotización: precio pendiente. Si el código tiene variantes, selecciona una en el buscador."}</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><label className="form-label" htmlFor={`ocr-type-${line.key}`}>Confirmar tipo *</label><select id={`ocr-type-${line.key}`} className="form-input bg-surface text-foreground" required value={line.catalogType} disabled={locked} onChange={(event) => update(line.key, "catalogType", event.target.value)}><option value="">Selecciona</option><option value="PRODUCT">Producto</option><option value="SERVICE">Servicio</option></select></div>
                      <div><label className="form-label" htmlFor={`ocr-code-${line.key}`}>Código leído *</label><input id={`ocr-code-${line.key}`} className="form-input bg-surface text-foreground" maxLength={120} required value={line.productCode} disabled={locked} onChange={(event) => update(line.key, "productCode", event.target.value)} /></div>
                    </div>
                    <GuideOcrVariants items={line.ocrCandidates ?? []} disabled={locked} onSelect={(item) => selectCatalogItem(line.key, item)} />
                  </div>}
                  <div className="guide-line-fields grid min-w-0 gap-4 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-[5.5rem_5.25rem_minmax(15rem,1.35fr)_minmax(10rem,1fr)_8rem] lg:items-start lg:gap-3">
                    <input type="hidden" name="lineId" value={line.lineId} />
                    <input type="hidden" name="lineUnitCode" value={line.unitCode} />
                    <input type="hidden" name="lineCatalogType" value={line.catalogType} />
                    <input type="hidden" name="lineCatalogItemId" value={line.catalogItemId} />
                    <input type="hidden" name="lineProductDescription" value={line.productDescription} />
                    <div className="min-w-0 sm:col-span-2 lg:order-3 lg:col-span-1"><label className="form-label" htmlFor={`line-catalog-${line.key}`}>{capture ? "Código *" : "Buscar producto o servicio *"}</label><DispatchCatalogCombobox id={`line-catalog-${line.key}`} projectId={projectId} value={selectionLabel} selectedId={line.catalogItemId} productUnitCode={programmedUnitCode} disabled={locked} onSelect={(item) => selectCatalogItem(line.key, item)} /></div>
                    <div className="grid min-w-0 grid-cols-2 gap-3 lg:contents">
                      <div className="min-w-0 lg:order-1"><label className="form-label" htmlFor={`line-quantity-${line.key}`}>Cantidad *</label><input id={`line-quantity-${line.key}`} name="lineQuantity" type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(event) => update(line.key, "quantity", event.target.value)} disabled={locked} className="form-input min-w-0 disabled:bg-muted" /></div>
                      <div className="min-w-0 lg:order-2"><label className="form-label" htmlFor={`line-unit-${line.key}`}>UM</label><select id={`line-unit-${line.key}`} title={line.unitCode || "Sin unidad de medida"} value={line.unitCode} onChange={(event) => update(line.key, "unitCode", event.target.value)} disabled={locked} className="form-input min-w-0 disabled:bg-muted"><option value="">—</option>{Array.from(new Set([...(line.catalogType === "SERVICE" ? SERVICE_UNIT_CODES : units.map((unit) => unit.code)), ...(line.unitCode ? [line.unitCode] : [])])).map((code) => <option key={code} value={code}>{code}</option>)}</select></div>
                    </div>
                    <div className="min-w-0 lg:order-4"><label className="form-label" htmlFor={`line-description-${line.key}`}>{line.catalogType === "PRODUCT" ? "Referencia" : "Descripción"}</label><textarea id={`line-description-${line.key}`} rows={2} maxLength={500} value={line.productDescription} title={line.productDescription || undefined} onChange={(event) => update(line.key, "productDescription", event.target.value)} disabled={locked || (line.catalogType !== "SERVICE" && !(capture && !line.catalogItemId))} placeholder="Se completa al seleccionar" className="form-input min-w-0 resize-y disabled:bg-muted" /></div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-sm sm:col-span-2 lg:order-5 lg:col-span-1 lg:flex-col lg:items-start lg:justify-start lg:gap-1 lg:border-t-0 lg:pt-0"><p className="text-xs text-foreground-muted lg:order-2">{line.unitPrice !== null && line.currency ? `${formatDispatchMoney(line.unitPrice, line.currency)} c/u` : capture && line.productCode ? "Precio pendiente de cotización" : "Selecciona un registro de la cotización"}</p><p className="font-semibold lg:order-1"><span className="lg:hidden">Estimado: </span><span className="hidden text-sm font-medium lg:mb-2 lg:block">Estimado</span>{subtotal === null || !line.currency ? "No disponible" : formatDispatchMoney(subtotal, line.currency)}</p></div>
                  </div>
                </article>
              );
            })}</GuideLinesList>
            {!readOnly && <button type="button" onClick={addLine} disabled={locked} className="secondary-button guide-add-mobile min-h-11 w-full gap-2 border-dashed"><Plus aria-hidden="true" className="size-4" /> Agregar producto / servicio</button>}
          </section>
  );

  return (
    <Dialog title={confirmClose ? "¿Descartar los cambios?" : guide ? (readOnly ? "Ver guía" : "Editar guía") : "Agregar guía"} description={confirmClose ? "La guía tiene cambios sin guardar." : "Registra los horarios del camión y cada producto o servicio de esta guía."} icon={PackageOpen} onClose={onClose} onBeforeClose={beforeClose} pending={pending || photoBusy} size={confirmClose ? "sm" : "xl"}>
      {confirmClose && <>
        <p className="p-5 text-sm leading-6 text-foreground-muted sm:p-6">Para conservar la eliminación y los demás cambios, vuelve al formulario y pulsa Guardar guía. Si descartas los cambios, la guía conservará sus datos anteriores.</p>
        <DialogFooter>
          <Button autoFocus variant="secondary" onClick={() => setConfirmClose(false)}>Seguir editando</Button>
          <Button variant="destructive" onClick={onClose}>Descartar cambios</Button>
        </DialogFooter>
      </>}
      <form hidden={confirmClose} className="dispatch-guide-form" onSubmit={(event) => {
        event.preventDefault();
        if (photoSelected && !capture) return;
        // Retain every controlled field when the action returns a validation
        // error. Native form-action resets can clear the visible service unit.
        const data = new FormData(event.currentTarget);
        startTransition(() => action(data));
      }}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="programmingId" value={programmingId} />
        <input type="hidden" name="dispatchId" value={dispatchId} />
        <input type="hidden" name="expectedVersion" value={Math.max(expectedVersion, savedVersion)} />
        <input type="hidden" name="guideId" value={guide?.id ?? ""} />
        <input type="hidden" name="guideDetails" value={JSON.stringify({ ...details, guideDate })} />
        <div className="space-y-5 p-4 sm:p-6">
          {!guide && state.status === "success" && <p role="status" className="text-sm text-success">Guía guardada. Puedes ingresar la siguiente o cerrar esta ventana.</p>}
          {ocrEnabled && !guide && !readOnly && <GuidePhotoCapture ref={photoCaptureRef} projectId={projectId} dispatchId={dispatchId} disabled={pending || Boolean(photoRetryGuide)} onRead={applyCapture} onReset={(usingPhoto) => {
            setPhotoSelected(usingPhoto); setCapture(null); setDetails(emptyGuideDetails()); setOcrReviewed(false); setCastingElement(""); setLaboratoryApplied(false);
            if (!usingPhoto) { setGuideNumber(""); setTruckArrivalTime(""); setTruckDepartureTime(""); setLines([initialLine(programmedUnitCode, defaultProductDescription ?? "", defaultCatalogProduct)]); }
          }} onBusy={setPhotoBusy} />}
          {ocrEnabled && guide && <SavedGuideOcrDetails projectId={projectId} dispatchId={dispatchId} guideId={guide.id} />}
          {capture && details && <>
            {warnings.length > 0 && <ul role="status" className="list-inside list-disc space-y-1 rounded-lg bg-amber-100 p-3 text-sm text-amber-950">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          </>}
          {(capture || !photoSelected) && <GuideOcrReview value={details} draft={capture?.draft} disabled={locked} onChange={(key, value) => {
            setDetails((current) => ({ ...current, [key]: value })); setOcrReviewed(false);
          }} number={numberField} date={dateField} arrival={arrivalField} departure={departureField} lines={lineEditor} timeHint={timeHint} />}
          {(capture || !photoSelected) && residentFields}
          {state.status === "error" && <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive">{state.message}</p>}
          {capture && <label className="flex min-h-11 items-start gap-3 rounded-xl border border-border p-4 text-sm"><input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={ocrReviewed} disabled={pending || photoBusy || Boolean(photoRetryGuide)} onChange={(event) => setOcrReviewed(event.target.checked)} />Revisé la foto y los datos extraídos, incluidos los horarios y todas las líneas. Confirmo los datos corregidos antes de guardar.</label>}
        </div>
        <DialogFooter><Button variant="secondary" onClick={requestClose} disabled={pending || photoBusy}>{readOnly ? "Cerrar" : "Cancelar"}</Button>{!readOnly && (!photoSelected || capture) && <LoadingButton loading={pending} loadingLabel="Guardando…" disabled={photoBusy || (photoSelected && !capture) || lines.length === 0 || (!capture && lines.some((line) => !line.catalogItemId && !line.lineId)) || Boolean(capture && !ocrReviewed)}>{photoRetryGuide ? "Reintentar foto" : capture ? "Guardar y escanear otra" : "Guardar guía"}</LoadingButton>}</DialogFooter>
      </form>
    </Dialog>
  );
}
