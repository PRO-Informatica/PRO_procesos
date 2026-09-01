"use client";

import {
  AlertTriangle,
  CheckCircle2,
  PencilLine,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { formatStatusLabel } from "@/lib/status-labels";

import { correctDispatchGuideAction } from "../actions";
import { formatDispatchQuantity } from "../formatters";
import {
  DISPATCH_RESULTS,
  initialCorrectionMutationState,
  type DispatchDetail,
  type DispatchResult,
} from "../types";

type Line = {
  id: string;
  quantity: string;
  unitCode: string;
  productCode: string;
  description: string;
};

function localTime(value: string | null, timezone: string) {
  if (!value) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((candidate) => candidate.type === type)?.value ?? "";
    return `${part("hour")}:${part("minute")}`;
  } catch {
    return "";
  }
}

export function CorrectDispatchGuideDialog({
  open,
  detail,
  timezone,
  onClose,
}: {
  open: boolean;
  detail: DispatchDetail;
  timezone: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const nextLineId = useRef(1);
  const [state, action, pending] = useActionState(
    correctDispatchGuideAction,
    initialCorrectionMutationState,
  );
  const [result, setResult] = useState<DispatchResult>(
    detail.result ?? "COMPLETE",
  );
  const [guideDate, setGuideDate] = useState(detail.guideDate ?? "");
  const [loadTime, setLoadTime] = useState(() =>
    localTime(detail.loadAt, timezone),
  );
  const [arrivalTime, setArrivalTime] = useState(() =>
    localTime(detail.arrivalAt, timezone),
  );
  const [departureTime, setDepartureTime] = useState(() =>
    localTime(detail.departureAt, timezone),
  );
  const [lines, setLines] = useState<Line[]>(() =>
    detail.guideLines.map((line) => ({
      id: line.id,
      quantity: String(line.quantity),
      unitCode: line.unitCode,
      productCode: line.productCode,
      description: line.productDescription,
    })),
  );
  const [sentInput, setSentInput] = useState(
    String(detail.dispatchedQuantity ?? ""),
  );
  const [receivedInput, setReceivedInput] = useState(
    String(detail.receivedQuantity ?? ""),
  );

  useGlobalPending(
    pending,
    "Corrigiendo guía…",
    "Guardando una nueva revisión inmutable y actualizando el resultado físico.",
  );
  useEffect(() => {
    if (state.status === "success") router.refresh();
  }, [router, state.status]);

  const documented = useMemo(
    () => lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
    [lines],
  );
  const sent =
    result === "NOT_DISPATCHED" || result === "CANCELLED"
      ? 0
      : result === "COMPLETE"
        ? documented
        : Number(sentInput || documented);
  const received =
    result === "COMPLETE"
      ? sent
      : result === "PARTIAL"
        ? Number(receivedInput || 0)
        : 0;
  const returned =
    result === "PARTIAL"
      ? Math.max(sent - received, 0)
      : result === "RETURNED" || result === "REJECTED"
        ? sent
        : 0;
  const unitLabel = lines[0]?.unitCode || detail.unitCode || "UM";

  const updateLine = (
    id: string,
    field: keyof Omit<Line, "id">,
    value: string,
  ) => {
    setLines((current) =>
      current.map((line) =>
        line.id === id ? { ...line, [field]: value } : line,
      ),
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] overflow-y-auto bg-black/50 p-3 backdrop-blur-[2px] sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="correct-guide-title"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
        >
          <motion.div
            className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            initial={reduceMotion ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduceMotion ? undefined : { y: 8, opacity: 0 }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
              <div className="flex gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-strong">
                  <PencilLine className="size-5" />
                </span>
                <div>
                  <h2
                    id="correct-guide-title"
                    className="font-semibold text-foreground"
                  >
                    Corregir guía
                  </h2>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Versión esperada {detail.version} · se conservará el
                    historial anterior.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="grid size-9 place-items-center rounded-lg text-foreground-muted hover:bg-muted"
                aria-label="Cerrar"
              >
                <X className="size-5" />
              </button>
            </div>

            {state.status === "success" ? (
              <div className="grid place-items-center px-5 py-14 text-center sm:px-8">
                <CheckCircle2 className="size-12 text-success" />
                <h3 className="mt-4 text-xl font-semibold text-foreground">
                  Guía corregida
                </h3>
                <p className="mt-2 max-w-lg text-sm text-foreground-muted">
                  La revisión {state.newVersion} quedó registrada. Documentos,
                  incidencias y programación se conservaron.
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="primary-button mt-6"
                >
                  Volver al detalle
                </button>
              </div>
            ) : (
              <form action={action} aria-busy={pending}>
                <input
                  type="hidden"
                  name="projectId"
                  value={detail.projectId}
                />
                <input type="hidden" name="dispatchId" value={detail.id} />
                <input
                  type="hidden"
                  name="programmingId"
                  value={detail.programmingId}
                />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={detail.version}
                />
                <input
                  type="hidden"
                  name="templateVersionId"
                  value={detail.guideTemplateVersionId ?? ""}
                />
                <input
                  type="hidden"
                  name="providerExtraData"
                  value={JSON.stringify(detail.guideProviderExtraData)}
                />
                <input
                  type="hidden"
                  name="loadAt"
                  value={loadTime ? `${guideDate}T${loadTime}` : ""}
                />
                <input
                  type="hidden"
                  name="arrivalAt"
                  value={arrivalTime ? `${guideDate}T${arrivalTime}` : ""}
                />
                <input
                  type="hidden"
                  name="departureAt"
                  value={departureTime ? `${guideDate}T${departureTime}` : ""}
                />
                <input type="hidden" name="dispatchedQuantity" value={sent} />
                <input type="hidden" name="receivedQuantity" value={received} />

                <div className="grid gap-6 p-5 sm:p-6">
                  <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label
                        className="form-label"
                        htmlFor="correction-guide-number"
                      >
                        Número de guía *
                      </label>
                      <input
                        id="correction-guide-number"
                        name="guideNumber"
                        required
                        maxLength={120}
                        defaultValue={detail.guideNumber ?? ""}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label
                        className="form-label"
                        htmlFor="correction-order-number"
                      >
                        Número de pedido
                      </label>
                      <input
                        id="correction-order-number"
                        name="orderNumber"
                        maxLength={120}
                        defaultValue={detail.guideOrderNumber ?? ""}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label
                        className="form-label"
                        htmlFor="correction-guide-date"
                      >
                        Fecha *
                      </label>
                      <input
                        id="correction-guide-date"
                        name="guideDate"
                        type="date"
                        required
                        value={guideDate}
                        onChange={(event) => setGuideDate(event.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label
                        className="form-label"
                        htmlFor="correction-receiver"
                      >
                        Receptor *
                      </label>
                      <input
                        id="correction-receiver"
                        name="receivedByName"
                        required
                        maxLength={160}
                        defaultValue={detail.receivedByName ?? ""}
                        className="form-input"
                      />
                    </div>
                  </section>

                  <section aria-labelledby="correction-products-title">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h3
                          id="correction-products-title"
                          className="text-sm font-semibold text-foreground"
                        >
                          Productos
                        </h3>
                        <p className="mt-1 text-xs text-foreground-muted">
                          La nueva revisión reemplaza el conjunto de líneas;
                          todas deben usar la misma UM.
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          setLines((current) => [
                            ...current,
                            {
                              id: `new-${nextLineId.current++}`,
                              quantity: "",
                              unitCode:
                                current[0]?.unitCode ?? detail.unitCode ?? "",
                              productCode: "",
                              description: "",
                            },
                          ])
                        }
                        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-muted"
                      >
                        <Plus className="size-4" /> Agregar producto
                      </button>
                    </div>
                    <div
                      className={`subtle-scrollbar mt-3 space-y-3 ${lines.length > 3 ? "max-h-[25rem] overflow-y-auto pr-1" : ""}`}
                    >
                      {lines.map((line, index) => (
                        <div
                          key={line.id}
                          className="grid gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:grid-cols-[2rem_8rem_7rem_10rem_minmax(12rem,1fr)_2.75rem] sm:items-end"
                        >
                          <span className="self-center text-xs font-semibold text-foreground-muted">
                            {index + 1}
                          </span>
                          <div>
                            <label className="form-label">Cantidad</label>
                            <input
                              name="lineQuantity"
                              type="number"
                              min="0.001"
                              step="0.001"
                              required
                              value={line.quantity}
                              onChange={(event) =>
                                updateLine(
                                  line.id,
                                  "quantity",
                                  event.target.value,
                                )
                              }
                              className="form-input"
                            />
                          </div>
                          <div>
                            <label className="form-label">UM</label>
                            <select
                              name="lineUnitCode"
                              required
                              value={line.unitCode}
                              onChange={(event) =>
                                updateLine(
                                  line.id,
                                  "unitCode",
                                  event.target.value,
                                )
                              }
                              className="form-input"
                            >
                              <option value="">—</option>
                              {detail.units.map((unit) => (
                                <option key={unit.code} value={unit.code}>
                                  {unit.code}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="form-label">Código</label>
                            <input
                              name="lineProductCode"
                              required
                              maxLength={120}
                              value={line.productCode}
                              onChange={(event) =>
                                updateLine(
                                  line.id,
                                  "productCode",
                                  event.target.value,
                                )
                              }
                              className="form-input"
                            />
                          </div>
                          <div>
                            <label className="form-label">Descripción</label>
                            <input
                              name="lineProductDescription"
                              required
                              maxLength={300}
                              value={line.description}
                              onChange={(event) =>
                                updateLine(
                                  line.id,
                                  "description",
                                  event.target.value,
                                )
                              }
                              className="form-input"
                            />
                          </div>
                          <button
                            type="button"
                            disabled={pending || lines.length === 1}
                            onClick={() =>
                              setLines((current) =>
                                current.filter(
                                  (candidate) => candidate.id !== line.id,
                                ),
                              )
                            }
                            className="grid size-11 place-items-center rounded-lg border border-border text-foreground-muted hover:bg-destructive-soft hover:text-destructive disabled:opacity-35"
                            aria-label={`Eliminar producto ${index + 1}`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <label
                        className="form-label"
                        htmlFor="correction-load-time"
                      >
                        Hora de carga
                      </label>
                      <input
                        id="correction-load-time"
                        type="time"
                        value={loadTime}
                        onChange={(event) => setLoadTime(event.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label
                        className="form-label"
                        htmlFor="correction-arrival-time"
                      >
                        Hora de llegada
                      </label>
                      <input
                        id="correction-arrival-time"
                        type="time"
                        value={arrivalTime}
                        onChange={(event) => setArrivalTime(event.target.value)}
                        className="form-input"
                      />
                    </div>
                    <div>
                      <label
                        className="form-label"
                        htmlFor="correction-departure-time"
                      >
                        Hora de salida
                      </label>
                      <input
                        id="correction-departure-time"
                        type="time"
                        value={departureTime}
                        onChange={(event) =>
                          setDepartureTime(event.target.value)
                        }
                        className="form-input"
                      />
                    </div>
                  </section>

                  <section className="grid gap-4 rounded-xl border border-border p-4 lg:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.2fr)]">
                    <div>
                      <label className="form-label" htmlFor="correction-result">
                        Resultado físico
                      </label>
                      <select
                        id="correction-result"
                        name="result"
                        value={result}
                        onChange={(event) =>
                          setResult(event.target.value as DispatchResult)
                        }
                        className="form-input"
                      >
                        {DISPATCH_RESULTS.map((value) => (
                          <option key={value} value={value}>
                            {formatStatusLabel(value)}
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs text-foreground-muted">
                        El estado del proceso permanece Registrado.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Physical
                        label="Documentada"
                        value={documented}
                        unit={unitLabel}
                      />
                      {result === "PARTIAL" ||
                      result === "RETURNED" ||
                      result === "REJECTED" ? (
                        <div>
                          <label
                            className="form-label"
                            htmlFor="correction-sent"
                          >
                            Enviada
                          </label>
                          <input
                            id="correction-sent"
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={sentInput}
                            onChange={(event) =>
                              setSentInput(event.target.value)
                            }
                            className="form-input"
                          />
                        </div>
                      ) : (
                        <Physical
                          label="Enviada"
                          value={sent}
                          unit={unitLabel}
                        />
                      )}
                      {result === "PARTIAL" ? (
                        <div>
                          <label
                            className="form-label"
                            htmlFor="correction-received"
                          >
                            Recibida
                          </label>
                          <input
                            id="correction-received"
                            type="number"
                            min="0.001"
                            step="0.001"
                            required
                            value={receivedInput}
                            onChange={(event) =>
                              setReceivedInput(event.target.value)
                            }
                            className="form-input"
                          />
                        </div>
                      ) : (
                        <Physical
                          label="Recibida"
                          value={received}
                          unit={unitLabel}
                        />
                      )}
                      <Physical
                        label="Devuelta"
                        value={returned}
                        unit={unitLabel}
                      />
                    </div>
                  </section>

                  <section>
                    <label className="form-label" htmlFor="correction-reason">
                      Motivo de la corrección *
                    </label>
                    <textarea
                      id="correction-reason"
                      name="reason"
                      required
                      maxLength={1000}
                      rows={3}
                      className="form-input min-h-24 resize-y"
                      placeholder="Describe qué se corrige y por qué."
                    />
                    <p className="mt-1.5 text-xs text-foreground-muted">
                      El motivo se conserva en la revisión y en auditoría.
                    </p>
                  </section>

                  {state.status === "error" && (
                    <div
                      role="alert"
                      className="rounded-xl bg-destructive-soft px-4 py-3 text-sm text-destructive"
                    >
                      <div className="flex gap-2">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        <div>
                          <p>{state.message}</p>
                          {state.conflict && (
                            <button
                              type="button"
                              onClick={() => {
                                onClose();
                                router.refresh();
                              }}
                              className="mt-3 inline-flex items-center gap-2 font-semibold underline underline-offset-4"
                            >
                              <RefreshCw className="size-4" /> Recargar datos
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-border px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={onClose}
                    className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-semibold hover:bg-muted"
                  >
                    Cancelar
                  </button>
                  <LoadingButton
                    loadingLabel="Corrigiendo guía…"
                    disabled={
                      !detail.guideTemplateVersionId || lines.length === 0
                    }
                  >
                    Guardar corrección
                  </LoadingButton>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Physical({
  label,
  value,
  unit,
}: {
  label: string;
  value: number;
  unit: string;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
        {label}
      </p>
      <p className="mt-2 font-semibold text-foreground">
        {formatDispatchQuantity(value)}{" "}
        <span className="text-xs text-foreground-muted">{unit}</span>
      </p>
    </div>
  );
}
