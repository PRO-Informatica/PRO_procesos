"use client";
import { CASTING_ELEMENTS } from "../casting-elements";

export function GuideResidentFields({ element, laboratory, showLaboratory = true, disabled, onElement, onLaboratory }: {
  element: string; laboratory: boolean | null; disabled: boolean;
  showLaboratory?: boolean;
  onElement: (value: string) => void; onLaboratory: (value: boolean) => void;
}) {
  return <section className="min-w-0 space-y-4 rounded-xl border border-border bg-muted/20 p-4" aria-labelledby="guide-resident-heading">
    <div><h3 id="guide-resident-heading" className="font-semibold">Registro del residente</h3><p className="mt-1 text-xs text-foreground-muted">Completa estos datos para esta guía.</p></div>
    <div className={`grid min-w-0 items-end gap-4 ${showLaboratory ? "sm:grid-cols-2" : ""}`}>
      <div><label className="form-label" htmlFor="guide-casting-element">Elemento a fundir *</label><select id="guide-casting-element" name="castingElement" className="form-input" required disabled={disabled} value={element} onChange={(event) => onElement(event.target.value)}><option value="">Selecciona</option>{Object.entries(CASTING_ELEMENTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      {showLaboratory && (laboratory === null ? <div><label className="form-label" htmlFor="guide-laboratory-applied">Se aplicó laboratorio *</label><select id="guide-laboratory-applied" name="laboratoryApplied" required value="" disabled={disabled} onChange={(event) => onLaboratory(event.target.value === "on")} className="form-input"><option value="">Sin registrar</option><option value="on">Sí</option><option value="no">No</option></select></div> : <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-3 text-sm"><input id="guide-laboratory-applied" name="laboratoryApplied" type="checkbox" checked={laboratory} disabled={disabled} onChange={(event) => onLaboratory(event.target.checked)} className="size-4 shrink-0 accent-success" />Se aplicó laboratorio</label>)}
    </div>
  </section>;
}
