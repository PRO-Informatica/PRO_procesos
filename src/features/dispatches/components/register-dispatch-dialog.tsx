"use client";

import { CheckCircle2, Plus, Trash2, Truck, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";

import { registerDispatchAction } from "../actions";
import { formatDispatchQuantity, formatIdentifier } from "../formatters";
import {
  DISPATCH_RESULTS,
  initialDispatchMutationState,
  type DispatchResult,
  type DispatchUnit,
  type EligibleProgramming,
} from "../types";
import { DocumentUploader } from "./document-uploader";

const resultLabels: Record<DispatchResult, string> = {
  COMPLETE: "Entrega completa",
  PARTIAL: "Entrega parcial",
  RETURNED: "Devuelto",
  REJECTED: "Rechazado",
  NOT_DISPATCHED: "No despachado",
  CANCELLED: "Cancelado",
};

type Line = { id: number; quantity: string; unitCode: string; productCode: string; description: string };

export function RegisterDispatchDialog({
  open,
  projectId,
  timezone,
  receiverName,
  programming,
  units,
  fixedProgrammingId,
  canAttachDocument,
  onClose,
}: {
  open: boolean;
  projectId: string;
  timezone: string;
  receiverName: string;
  programming: EligibleProgramming[];
  units: DispatchUnit[];
  fixedProgrammingId?: string;
  canAttachDocument: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const nextLineId = useRef(2);
  const [state, action, pending] = useActionState(registerDispatchAction, initialDispatchMutationState);
  const [programmingId, setProgrammingId] = useState(fixedProgrammingId ?? programming[0]?.id ?? "");
  const [result, setResult] = useState<DispatchResult>("COMPLETE");
  const [guideDate, setGuideDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "America/Guatemala" }).format(new Date()));
  const [loadTime, setLoadTime] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [departureTime, setDepartureTime] = useState("");
  const [lines, setLines] = useState<Line[]>([{
    id: 1,
    quantity: "",
    unitCode: programming.find((item) => item.id === fixedProgrammingId)?.unitCode
      ?? programming[0]?.unitCode
      ?? units[0]?.code
      ?? "",
    productCode: "",
    description: "",
  }]);
  const [sentInput, setSentInput] = useState("");
  const [receivedInput, setReceivedInput] = useState("");

  useGlobalPending(pending, "Registrando despacho…", "Creando guía, productos y trazabilidad operacional.");
  useEffect(() => { if (state.status === "success") router.refresh(); }, [router, state.status]);

  const selected = programming.find((item) => item.id === programmingId);
  const documented = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0), [lines]);
  const sent = result === "NOT_DISPATCHED" || result === "CANCELLED" ? 0
    : result === "COMPLETE" ? documented
      : Number(sentInput || documented);
  const received = result === "COMPLETE" ? sent : result === "PARTIAL" ? Number(receivedInput || 0) : 0;
  const returned = result === "PARTIAL" ? Math.max(sent - received, 0)
    : result === "RETURNED" || result === "REJECTED" ? sent : 0;
  const unitLabel = lines[0]?.unitCode || selected?.unitCode || "UM";

  const updateLine = (id: number, field: keyof Omit<Line, "id">, value: string) => {
    setLines((current) => current.map((line) => line.id === id ? { ...line, [field]: value } : line));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] overflow-y-auto bg-black/50 p-3 backdrop-blur-[2px] sm:p-6" role="dialog" aria-modal="true" aria-labelledby="register-dispatch-title" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }}>
          <motion.div className="mx-auto my-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" initial={reduceMotion ? false : { y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={reduceMotion ? undefined : { y: 8, opacity: 0 }}>
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div className="flex gap-3"><span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-strong"><Truck className="size-5" /></span><div><h2 id="register-dispatch-title" className="font-semibold text-foreground">Registrar despacho</h2><p className="mt-1 text-xs text-foreground-muted">Guía y recepción · zona horaria {timezone || "America/Guatemala"}</p></div></div>
              <button type="button" onClick={onClose} disabled={pending} className="grid size-9 place-items-center rounded-lg text-foreground-muted hover:bg-muted" aria-label="Cerrar"><X className="size-5" /></button>
            </div>

            {state.status === "success" && state.dispatchId ? (
              <div className="grid place-items-center px-5 py-14 text-center sm:px-8">
                <CheckCircle2 className="size-12 text-success" />
                <h3 className="mt-4 text-xl font-semibold text-foreground">Despacho registrado</h3>
                <p className="mt-2 max-w-md text-sm text-foreground-muted">La guía, sus productos y las cantidades físicas quedaron registrados como un solo expediente.</p>
                {canAttachDocument && state.guideId ? (
                  <div className="mt-6 w-full max-w-xl rounded-xl border border-border bg-muted/20 p-4 text-left sm:p-5">
                    <h4 className="font-semibold text-foreground">Documento de guía</h4>
                    <p className="mt-1 text-xs leading-5 text-foreground-muted">Adjunta ahora la foto, boleta o PDF físico de la guía. Si la carga falla, el despacho permanece registrado y podrás reintentar.</p>
                    <div className="mt-4">
                      <DocumentUploader projectId={projectId} contextId={state.guideId} context="guide" label="Subir foto o PDF" />
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 max-w-md text-xs text-foreground-muted">Puedes continuar al detalle para consultar el expediente y registrar incidencias.</p>
                )}
                <div className="mt-6 flex flex-col gap-3 sm:flex-row"><button type="button" onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold">Cerrar</button><Link href={`/dispatches/${state.dispatchId}`} className="primary-button">Abrir detalle y continuar</Link></div>
              </div>
            ) : (
              <form action={action} aria-busy={pending}>
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="programmingId" value={programmingId} />
                <input type="hidden" name="loadAt" value={loadTime ? `${guideDate}T${loadTime}` : ""} />
                <input type="hidden" name="arrivalAt" value={arrivalTime ? `${guideDate}T${arrivalTime}` : ""} />
                <input type="hidden" name="departureAt" value={departureTime ? `${guideDate}T${departureTime}` : ""} />
                <input type="hidden" name="dispatchedQuantity" value={sent} />
                <input type="hidden" name="receivedQuantity" value={received} />

                <div className="grid gap-6 p-5 sm:p-6">
                  <section className="grid gap-4 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-2">
                    <div className="sm:col-span-2"><label className="form-label" htmlFor="dispatch-programming">Programación</label>{fixedProgrammingId ? <div className="form-input bg-muted/40 font-mono font-semibold">{formatIdentifier("PRG", programmingId)}</div> : <select id="dispatch-programming" required className="form-input" value={programmingId} onChange={(event) => { setProgrammingId(event.target.value); const next = programming.find((item) => item.id === event.target.value); if (next) setLines((current) => current.map((line) => ({ ...line, unitCode: next.unitCode }))); }}><option value="">Selecciona una programación</option>{programming.map((item) => <option key={item.id} value={item.id}>{formatIdentifier("PRG", item.id)} · {item.supplierName} · {item.status}</option>)}</select>}</div>
                    <div><span className="form-label">Proveedor</span><div className="form-input bg-muted/40 font-medium">{selected?.supplierName ?? "Selecciona una programación"}</div></div>
                    <div><span className="form-label">Template</span><div className="form-input bg-muted/40 text-foreground-muted">DISPATCH_GUIDE publicada · resolución automática</div></div>
                  </section>

                  <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div><label className="form-label" htmlFor="guide-number">Número de guía *</label><input id="guide-number" name="guideNumber" required maxLength={120} className="form-input" /></div>
                    <div><label className="form-label" htmlFor="order-number">Número de pedido</label><input id="order-number" name="orderNumber" maxLength={120} className="form-input" /></div>
                    <div><label className="form-label" htmlFor="guide-date">Fecha *</label><input id="guide-date" name="guideDate" type="date" required value={guideDate} onChange={(event) => setGuideDate(event.target.value)} className="form-input" /></div>
                    <div><label className="form-label" htmlFor="receiver">Receptor *</label><input id="receiver" name="receivedByName" required defaultValue={receiverName} maxLength={160} className="form-input" /></div>
                  </section>

                  <section aria-labelledby="dispatch-products-title"><div className="flex items-end justify-between gap-3"><div><h3 id="dispatch-products-title" className="text-sm font-semibold text-foreground">Productos</h3><p className="mt-1 text-xs text-foreground-muted">Todas las líneas deben utilizar la misma UM.</p></div><button type="button" disabled={pending} onClick={() => setLines((current) => [...current, { id: nextLineId.current++, quantity: "", unitCode: current[0]?.unitCode ?? selected?.unitCode ?? "", productCode: "", description: "" }])} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted"><Plus className="size-4" /> Agregar producto</button></div>
                    <div className={`subtle-scrollbar mt-3 space-y-3 ${lines.length > 3 ? "max-h-[25rem] overflow-y-auto pr-1" : ""}`}>{lines.map((line, index) => <div key={line.id} className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-[2rem_8rem_7rem_10rem_minmax(12rem,1fr)_2.75rem] sm:items-end"><span className="self-center text-xs font-semibold text-foreground-muted">{index + 1}</span><div><label className="form-label">Cantidad</label><input name="lineQuantity" type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(e) => updateLine(line.id, "quantity", e.target.value)} className="form-input" /></div><div><label className="form-label">UM</label><select name="lineUnitCode" required value={line.unitCode} onChange={(e) => updateLine(line.id, "unitCode", e.target.value)} className="form-input"><option value="">—</option>{units.map((unit) => <option key={unit.code} value={unit.code}>{unit.code}</option>)}</select></div><div><label className="form-label">Código</label><input name="lineProductCode" required maxLength={120} value={line.productCode} onChange={(e) => updateLine(line.id, "productCode", e.target.value)} className="form-input" /></div><div><label className="form-label">Descripción</label><input name="lineProductDescription" required maxLength={300} value={line.description} onChange={(e) => updateLine(line.id, "description", e.target.value)} className="form-input" /></div><button type="button" disabled={pending || lines.length === 1} onClick={() => setLines((current) => current.filter((candidate) => candidate.id !== line.id))} className="grid size-11 place-items-center rounded-lg border border-border text-foreground-muted hover:bg-destructive-soft hover:text-destructive disabled:opacity-35" aria-label={`Eliminar producto ${index + 1}`}><Trash2 className="size-4" /></button></div>)}</div>
                  </section>

                  <section className="grid gap-4 sm:grid-cols-3"><div><label className="form-label" htmlFor="load-time">Hora de carga</label><input id="load-time" type="time" value={loadTime} onChange={(e) => setLoadTime(e.target.value)} className="form-input" /></div><div><label className="form-label" htmlFor="arrival-time">Hora de llegada</label><input id="arrival-time" type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className="form-input" /></div><div><label className="form-label" htmlFor="departure-time">Hora de salida</label><input id="departure-time" type="time" value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} className="form-input" /></div></section>

                  <section className="grid gap-4 rounded-xl border border-border p-4 lg:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.2fr)]"><div><label className="form-label" htmlFor="dispatch-result">Resultado físico</label><select id="dispatch-result" name="result" value={result} onChange={(e) => setResult(e.target.value as DispatchResult)} className="form-input">{DISPATCH_RESULTS.map((value) => <option key={value} value={value}>{resultLabels[value]}</option>)}</select><p className="mt-2 text-xs text-foreground-muted">Independiente del estado del proceso, que inicia como REGISTERED.</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Physical label="Documentada" value={documented} unit={unitLabel} />{result === "PARTIAL" || result === "RETURNED" || result === "REJECTED" ? <div><label className="form-label" htmlFor="sent-quantity">Enviada</label><input id="sent-quantity" type="number" min="0.001" step="0.001" value={sentInput} placeholder={String(documented || "")} onChange={(e) => setSentInput(e.target.value)} className="form-input" /></div> : <Physical label="Enviada" value={sent} unit={unitLabel} />}{result === "PARTIAL" ? <div><label className="form-label" htmlFor="received-quantity">Recibida</label><input id="received-quantity" type="number" min="0.001" step="0.001" required value={receivedInput} onChange={(e) => setReceivedInput(e.target.value)} className="form-input" /></div> : <Physical label="Recibida" value={received} unit={unitLabel} />}<Physical label="Devuelta" value={returned} unit={unitLabel} /></div></section>

                  {state.status === "error" && <p role="alert" className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive">{state.message}</p>}
                </div>
                <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6"><button type="button" disabled={pending} onClick={onClose} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted">Cancelar</button><LoadingButton loadingLabel="Registrando despacho…" disabled={!programmingId}>Registrar despacho</LoadingButton></div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Physical({ label, value, unit }: { label: string; value: number; unit: string }) {
  return <div className="rounded-lg bg-muted/50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">{label}</p><p className="mt-2 font-semibold text-foreground">{formatDispatchQuantity(value)} <span className="text-xs text-foreground-muted">{unit}</span></p></div>;
}
