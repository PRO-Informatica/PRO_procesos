"use client";

import Link from "next/link";
import { ChevronDown, Filter, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { DateRangePicker } from "@/components/ui/date-range/date-range-picker";
import { CASTING_ELEMENTS } from "@/features/dispatches/casting-elements";
import type { GuideReportData, GuideReportFilters, ReportOption } from "../types";
import type { RadarFilters } from "../radar";
import styles from "./report-filters.module.css";

function Select({ name, label, value, options, children }: { name: string; label: string; value?: string; options?: ReportOption[]; children?: ReactNode }) {
  return <label className={styles.field}><span>{label}</span><select name={name} defaultValue={value ?? ""} className="form-input"><option value="">{name === "project" ? "Todos los proyectos autorizados" : "Todos"}</option>{children ?? options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function Text({ name, label, value, placeholder }: { name: string; label: string; value?: string; placeholder?: string }) {
  return <label className={styles.field}><span>{label}</span><input name={name} defaultValue={value ?? ""} placeholder={placeholder} className="form-input" /></label>;
}
function Billing({ value }: { value?: string }) {
  return <Select name="billing" label="Conciliación completa" value={value}><option value="reconciled">Producto y Servicio conciliados</option><option value="pending">Pendientes de conciliación</option></Select>;
}
function CastingElement({ value }: { value?: string }) {
  return <Select name="castingElement" label="Elemento a fundir" value={value} options={Object.entries(CASTING_ELEMENTS).map(([value, label]) => ({ value, label }))} />;
}
function FilterPanel({ title, description, root, primary, advanced, advancedCount, initialCount, supplier }: { title: string; description: string; root: string; primary: ReactNode; advanced: ReactNode; advancedCount: number; initialCount: number; supplier?: boolean }) {
  const [count, setCount] = useState(initialCount);
  return <section className={styles.panel} aria-label={title}>
    <header className={styles.header}><div className={styles.heading}><Filter size={18} aria-hidden="true" /><div><h2>{title}</h2><p>{description}</p></div></div>{supplier && <span className={styles.supplier}>Proveedor: Mixto Listo</span>}</header>
    <form action={root} method="get" onChange={(event) => {
      const values = new FormData(event.currentTarget);
      setCount([...values.entries()].filter(([key, value]) => !["from", "to", "scope"].includes(key) && String(value).trim()).length);
    }}>
      <input type="hidden" name="scope" value="universal" />
      <div className={styles.primary}>{primary}</div>
      <details className={styles.advanced} open={advancedCount > 0 || undefined}>
        <summary><Filter size={14} aria-hidden="true" />Más filtros{advancedCount > 0 && <span>{advancedCount} aplicado(s)</span>}<ChevronDown size={16} aria-hidden="true" /></summary>
        <div className={styles.advancedGrid}>{advanced}</div>
      </details>
      <footer className={styles.footer}><p role="status" aria-live="polite">{count ? `${count} filtro(s) seleccionado(s)` : "Todos los resultados del rango seleccionado"}</p><div><Link href={root === "/reports/universal" ? root : `${root}?scope=universal`} className="secondary-button"><RotateCcw size={15} aria-hidden="true" />Limpiar</Link><button type="submit" className="primary-button">Aplicar filtros</button></div></footer>
    </form>
    <p className={styles.hint}>Conciliación completa requiere Producto y Servicio conciliados. Concreto directo conserva su excepción de Servicio.</p>
  </section>;
}

export function GeneralReportFilters({ filters, options }: { filters: GuideReportFilters; options: GuideReportData["filters"] }) {
  const advancedValues = [filters.userId, filters.batchId, filters.billingStatus, filters.dispatchStatus, filters.castingElement, filters.reconciliationStatus, filters.withIncidents];
  const advancedCount = advancedValues.filter(Boolean).length;
  return <FilterPanel title="Filtros del reporte" description="Consulta proyectos de todas tus compañías autorizadas. Excel y ZIP utilizarán este mismo resultado." root="/reports/universal" supplier advancedCount={advancedCount} initialCount={advancedCount + [filters.projectId, filters.orderNumber].filter(Boolean).length}
    primary={<><DateRangePicker from={filters.dateFrom} to={filters.dateTo} /><Select name="project" label="Proyecto · compañía" value={filters.projectId} options={options.projects} /><Text name="order" label="Número de pedido" value={filters.orderNumber} placeholder="Ej. 47" /></>}
    advanced={<><Billing value={filters.billingStatus} /><Select name="dispatchStatus" label="Estado del despacho" value={filters.dispatchStatus}><option value="IN_EXECUTION">En ejecución</option><option value="COMPLETED">Operación finalizada</option></Select><Select name="batch" label="Lote" value={filters.batchId} options={options.batches} /><CastingElement value={filters.castingElement} /><Select name="user" label="Creado o registrado por" value={filters.userId} options={options.users} /><Select name="incidents" label="Incidencias" value={filters.withIncidents}><option value="yes">Con incidencias</option><option value="no">Sin incidencias</option></Select><Select name="reconciliation" label="Conciliación de Producto" value={filters.reconciliationStatus}><option value="NOT_STARTED">Sin iniciar</option><option value="PENDING_RECONCILIATION">Pendiente de conciliación</option><option value="WITH_DIFFERENCES">Con diferencias</option><option value="PENDING_REINVOICING">Pendiente de liquidación</option><option value="RECONCILED">Conciliado</option></Select></>}
  />;
}

export function DispatchReportFilters({ filters, projects, route }: { filters: RadarFilters; projects: ReportOption[]; route: string }) {
  const advancedCount = [filters.guide, filters.truck, filters.concrete, filters.laboratory, filters.castingElement, filters.billingStatus].filter(Boolean).length;
  return <FilterPanel title="Filtros por despacho" description="La fecha corresponde a la programación del despacho. El Excel incluye todas las guías de los despachos encontrados." root={route} advancedCount={advancedCount} initialCount={advancedCount + [filters.projectId, filters.dispatch].filter(Boolean).length}
    primary={<><DateRangePicker from={filters.dateFrom} to={filters.dateTo} /><Select name="project" label="Proyecto · compañía" value={filters.projectId} options={projects} /><Text name="dispatch" label="Despacho" value={filters.dispatch} placeholder="Ej. DSP-A179CABC" /></>}
    advanced={<><Text name="guide" label="Número de guía / boleta" value={filters.guide} placeholder="Ej. 6015-000543" /><Text name="truck" label="Número de camión" value={filters.truck} placeholder="Ej. 183" /><Text name="concrete" label="Concreto / Servicio" value={filters.concrete} placeholder="Ej. CONF4001 o Servicio" /><Select name="laboratory" label="Se aplicó laboratorio" value={filters.laboratory}><option value="yes">Sí</option><option value="no">No</option></Select><CastingElement value={filters.castingElement} /><Billing value={filters.billingStatus} /></>}
  />;
}
