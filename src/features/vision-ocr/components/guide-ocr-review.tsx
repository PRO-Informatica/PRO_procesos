"use client";

import type { ReactNode } from "react";
import { GUIDE_FIELDS, type GuideDetails, type GuideField, type GuideOcrDraft } from "../guide-draft";

// Keep the familiar zones of the paper guide while retaining editable,
// labelled inputs. Photo text is informational; it never changes app scope.
export function GuideOcrReview({ value, onChange, disabled, draft, number, date, arrival, departure, lines, timeHint }: {
  value: GuideDetails; onChange: (key: GuideField, value: string) => void;
  disabled: boolean; draft?: GuideOcrDraft;
  number: ReactNode; date: ReactNode; arrival: ReactNode; departure: ReactNode;
  lines: ReactNode; timeHint: ReactNode;
}) {
  const field = (key: GuideField, rows = 1) => {
    const score = draft?.confidence[key];
    const uncertain = score !== undefined && (score === null || score < 0.8);
    const id = `${draft ? "ocr" : "guide-field"}-${key}`;
    return <div className="min-w-0">
      <label className="form-label" htmlFor={id}>{GUIDE_FIELDS[key]}{uncertain && <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">Revisar lectura</span>}</label>
      {key === "loadingTime"
        ? <input id={id} type="time" disabled={disabled} value={value[key]} onChange={(event) => onChange(key, event.target.value)} className={`form-input min-w-0 disabled:bg-muted ${uncertain ? "border-amber-400" : ""}`} />
        : <textarea id={id} rows={rows} maxLength={key === "observations" ? 4000 : 500} disabled={disabled} value={value[key]} onChange={(event) => onChange(key, event.target.value)} className={`form-input min-w-0 resize-y disabled:bg-muted ${uncertain ? "border-amber-400" : ""}`} />}
    </div>;
  };
  return <section className="min-w-0 space-y-4" aria-label={draft ? "Revisión de la guía" : "Ingreso manual de la guía"}>
    {draft && <header><h3 id="ocr-review-heading" className="text-lg font-bold">Revisión de la guía</h3><p className="mt-1 text-xs text-foreground-muted">Revisa cada apartado y completa el registro del residente antes de guardar.</p></header>}
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4" aria-labelledby="guide-identification-heading">
      <h4 id="guide-identification-heading" className="font-semibold">Datos de la guía</h4>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">{number}{date}{field("orderNumber")}</div>
    </section>
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4" aria-labelledby="guide-work-heading">
      <h4 id="guide-work-heading" className="font-semibold">Cliente y obra</h4>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{field("customerName", 2)}{field("projectName", 2)}<div className="sm:col-span-2">{field("workAddress", 2)}</div></div>
    </section>
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4" aria-labelledby="guide-truck-heading">
      <h4 id="guide-truck-heading" className="font-semibold">Camión y horarios</h4>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{field("plant")}{field("truck")}</div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-3">{field("loadingTime")}{arrival}{departure}</div>
      {timeHint}
    </section>
    <div className="min-w-0 rounded-xl border border-border bg-surface p-3 sm:p-4">{lines}</div>
    <section className="space-y-4 rounded-xl border border-border bg-surface p-4" aria-labelledby="guide-staff-heading">
      <h4 id="guide-staff-heading" className="font-semibold">Personal y observaciones</h4>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">{field("pilot")}{field("operator")}<div className="sm:col-span-2">{field("observations", 3)}</div></div>
    </section>
  </section>;
}
