"use client";

import { AlertTriangle, ArrowRight, Clock3 } from "lucide-react";
import { motion, useInView, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Pagination } from "@/components/ui/pagination";

import { formatDashboardDateTime } from "../formatters";
import { agingPlotLimit, DAY_MS, dispatchAgingSamples, formatReinvoicingAge, projectAgingSamples, REINVOICING_ALERT_DAYS, type ReinvoicingAging } from "../reinvoicing-aging";
import styles from "./dashboard-charts.module.css";

const PAGE_SIZE = 8;
const alertDuration = REINVOICING_ALERT_DAYS * DAY_MS;
const selectStyle = "min-h-10 w-full min-w-0 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-brand";
const modeStyle = "min-h-10 flex-1 whitespace-nowrap rounded-md px-3 text-xs font-semibold text-foreground-muted transition hover:text-foreground aria-pressed:bg-surface aria-pressed:text-foreground aria-pressed:shadow-sm focus-visible:outline-2 focus-visible:outline-brand";
const chartTick = { fill: "var(--foreground-muted)", fontSize: 11 };
const averageLine = { key: "average", name: "Antigüedad promedio", color: "var(--aging-blue)" };
const longestLine = { key: "longest", name: "Mayor antigüedad", color: "var(--brand-strong)" };

const dateLabel = (time: number, timezone: string, year = false) => new Intl.DateTimeFormat("es-GT", {
  day: "2-digit", month: "2-digit", year: year ? "numeric" : undefined, timeZone: timezone,
}).format(time);

export function ReinvoicingAgingChart({ data, timezone }: { data: ReinvoicingAging | null; timezone: string }) {
  const titleId = useId();
  const dotTitleId = useId();
  const reducedMotion = useReducedMotion();
  const plotRef = useRef<HTMLDivElement>(null);
  const detailControl = useRef<HTMLButtonElement>(null);
  const pointDetailRef = useRef<HTMLDivElement>(null);
  const plotVisible = useInView(plotRef, { once: true, amount: 0.25 });
  const [view, setView] = useState<"general" | "dispatch">("general");
  const [days, setDays] = useState(30);
  const [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState(1);
  const [pointId, setPointId] = useState("");

  const general = view === "general";
  const asOf = data?.asOf ?? 0;
  const cases = data?.cases;
  const total = cases?.length ?? 0;
  const alertCount = cases?.filter(({ startedAt }) => startedAt !== null && asOf - startedAt >= alertDuration).length ?? 0;
  const noDateCount = cases?.filter(({ startedAt }) => startedAt === null).length ?? 0;
  const selected = cases?.find(({ id }) => id === selectedId) ?? cases?.[0];
  const startedAt = selected?.startedAt;
  const canPlot = general ? total > noDateCount : startedAt != null;
  const values = useMemo(() => {
    if (!canPlot) return [];
    if (general) return projectAgingSamples(asOf, days, cases ?? []);
    return startedAt == null ? [] : dispatchAgingSamples(asOf, days, startedAt);
  }, [asOf, canPlot, cases, days, general, startedAt]);
  const singlePoint = values.filter((point) => "age" in point ? point.age !== null : point.average !== null).length === 1;
  const lines = general ? [averageLine, longestLine] : [{ key: "age", name: selected?.code ?? "Despacho", color: "var(--brand-strong)" }];
  const limit = useMemo(() => agingPlotLimit(asOf, cases ?? []), [asOf, cases]);
  const thresholdPosition = `${REINVOICING_ALERT_DAYS / limit * 100}%`;
  const currentPage = Math.min(page, Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const visible = cases?.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const detail = general ? visible?.find(({ id }) => id === pointId) : selected;

  function showDispatch(id: string) {
    setSelectedId(id);
    setView("dispatch");
    detailControl.current?.focus();
    detailControl.current?.scrollIntoView({ block: "nearest" });
  }

  function showPoint(id: string) {
    setPointId(pointId === id ? "" : id);
    if (pointId !== id) requestAnimationFrame(() => pointDetailRef.current?.scrollIntoView({ block: "nearest" }));
  }

  return (
    <section aria-labelledby={titleId} className={`${styles.aging} min-w-0 rounded-xl border border-border bg-surface p-4 sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="flex items-center gap-2 font-semibold text-foreground"><Clock3 aria-hidden="true" className="size-4 text-brand-strong" />Tiempo pendiente de liquidación</h2>
          <p className="mt-1 text-xs text-foreground-muted">Días corridos desde la solicitud de refacturación.</p>
        </div>
        {alertCount > 0 && <p className="inline-flex items-center gap-1.5 rounded-md bg-destructive-soft px-2.5 py-1.5 text-xs font-semibold text-destructive"><AlertTriangle aria-hidden="true" className="size-3.5" />{alertCount} {alertCount === 1 ? "despacho" : "despachos"} con {REINVOICING_ALERT_DAYS} días o más</p>}
      </div>

      {!total ? (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/25 p-4 text-sm text-foreground-muted">
          {data ? "No hay despachos pendientes de liquidación." : "No se pudo consultar el historial de refacturación."}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
            <div className="inline-flex w-full rounded-lg bg-muted p-1 sm:w-auto" role="group" aria-label="Vista de refacturación">
              <button className={modeStyle} type="button" aria-pressed={general} onClick={() => setView("general")}>Vista general</button>
              <button className={modeStyle} ref={detailControl} type="button" aria-pressed={!general} onClick={() => setView("dispatch")}>Por despacho</button>
            </div>
            <label className="min-w-0 flex-1 sm:max-w-48"><span className="mb-1 block text-xs font-medium text-foreground-muted">Periodo de la gráfica de líneas</span>
              <select className={selectStyle} value={days} onChange={(event) => setDays(Number(event.target.value))} disabled={!canPlot}>
                {[7, 30, 90].map((period) => <option key={period} value={period}>Últimos {period} días</option>)}
              </select>
            </label>
          </div>

          {general ? (
            <div className="mt-4">
              <p className="text-sm font-semibold text-foreground">{total} {total === 1 ? "despacho pendiente" : "despachos pendientes"}{noDateCount > 0 && <span className="font-normal text-foreground-muted"> · {noDateCount} sin fecha de inicio</span>}</p>
              {canPlot && <p className="mt-1 text-xs text-foreground-muted">Promedio y mayor antigüedad de los despachos que siguen pendientes y tienen fecha registrada.</p>}
            </div>
          ) : (
            <label className="mt-4 block min-w-0 sm:max-w-md"><span className="mb-1 block text-xs font-medium text-foreground-muted">Elegir despacho</span>
              <select className={selectStyle} value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
                {cases?.map((item) => <option key={item.id} value={item.id}>{item.code}{item.orderNumber ? ` · Pedido ${item.orderNumber}` : ""} · {item.startedAt === null ? "Sin fecha" : formatReinvoicingAge(asOf - item.startedAt)}</option>)}
              </select>
            </label>
          )}

          {canPlot ? (
            <>
              {general && <h3 className="mt-4 text-sm font-semibold text-foreground">Gráfica de líneas</h3>}
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-foreground-muted" aria-label="Series de la gráfica" role="group">
                {lines.map((line) => <span key={line.key} className="inline-flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: line.color }} />{line.name}</span>)}
              </div>
              <div ref={plotRef} className="mt-3 h-[225px] min-w-0 sm:h-[270px]" role="group" aria-label={general ? "Antigüedad general de refacturación" : "Antigüedad del despacho seleccionado"}>
                {(plotVisible || reducedMotion) && <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <LineChart<(typeof values)[number]> key={general ? "general" : selected?.id} data={values} margin={{ top: 10, right: 13, bottom: 4, left: 0 }} accessibilityLayer>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="time" domain={[asOf - days * DAY_MS, asOf]} axisLine={false} tickLine={false} tick={chartTick}
                      minTickGap={25} tickFormatter={(time: number) => dateLabel(time, timezone)} />
                    <YAxis width={40} domain={[0, (max: number) => Math.max(REINVOICING_ALERT_DAYS + 1, Math.ceil(max))]} axisLine={false} tickLine={false} tick={chartTick}
                      allowDecimals={false} tickFormatter={(value: number) => `${value} d`} />
                    <ReferenceLine y={REINVOICING_ALERT_DAYS} stroke="var(--destructive)" strokeOpacity={0.65} strokeDasharray="5 4" />
                    <Tooltip cursor={{ stroke: "var(--border)" }} labelFormatter={(time) => dateLabel(Number(time), timezone, true)}
                      formatter={(value, name) => [formatReinvoicingAge(Number(value) * DAY_MS), name]}
                      contentStyle={{ background: "var(--surface)", color: "var(--foreground)", borderColor: "var(--border)", borderRadius: 8, fontSize: 12 }}
                      itemStyle={{ color: "var(--foreground)" }} />
                    {lines.map((line) => <Line key={line.key} type="linear" dataKey={line.key} name={line.name} stroke={line.color} strokeWidth={2}
                      dot={singlePoint}
                      activeDot={{ r: 5, stroke: "var(--surface)", strokeWidth: 2 }} isAnimationActive={!reducedMotion} animationDuration={650} />)}
                  </LineChart>
                </ResponsiveContainer>}
              </div>
              <p className="text-xs text-foreground-muted"><span aria-hidden="true" className="mr-2 inline-block w-5 align-middle border-t border-dashed border-destructive" />Alerta a partir de {REINVOICING_ALERT_DAYS} días corridos</p>
            </>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/25 p-4 text-sm text-foreground-muted">
              {general ? "Las solicitudes pendientes están sin fecha de inicio registrada." : "Este despacho está sin fecha de inicio registrada."}
            </p>
          )}

          {general && (
            <section className="mt-5 border-t border-border pt-4" aria-labelledby={dotTitleId}>
              <h3 id={dotTitleId} className="text-sm font-semibold text-foreground">Gráfica de puntos</h3>
              <p className="mt-1 text-xs text-foreground-muted">Antigüedad actual por despacho, del más antiguo al más reciente.</p>
              {canPlot && <p className="mt-2 flex items-center gap-2 text-xs text-foreground-muted"><span className="size-2 rounded-full bg-destructive" aria-hidden="true" />{REINVOICING_ALERT_DAYS} días o más</p>}
              <div className="mt-3 overflow-hidden rounded-lg border border-border">
                <table className="w-full table-fixed text-left text-xs">
                  <caption className="sr-only">Todos los despachos pendientes de liquidación</caption>
                  <colgroup><col className="w-[6rem] sm:w-[11rem]" /><col /><col className="w-[4.75rem] sm:w-28" /></colgroup>
                  <thead className="bg-muted text-foreground-muted">
                    <tr>
                      <th scope="col" className="px-2 py-2.5 sm:px-3">Despacho</th>
                      <th scope="col" className={styles.dotCell} aria-label="Días corridos en refacturación">
                        {canPlot && <span className={`${styles.dotTrack} flex items-center justify-between tabular-nums`} aria-hidden="true">
                          <span>0</span>
                          {limit <= 28 && <span className="absolute -translate-x-1/2 text-destructive" style={{ left: thresholdPosition }}>{REINVOICING_ALERT_DAYS}</span>}
                          <span>{limit} d</span>
                        </span>}
                      </th>
                      <th scope="col" className="px-2 py-2.5 text-right sm:px-3">Antigüedad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible?.map((item) => {
                      const elapsed = item.startedAt === null ? null : asOf - item.startedAt;
                      const overdue = elapsed !== null && elapsed >= alertDuration;
                      return <tr key={item.id} className="border-t border-border">
                        <th scope="row" className="px-2 py-2 font-semibold text-foreground sm:px-3">{item.code}{item.orderNumber && <span className="block font-normal text-foreground-muted">Pedido {item.orderNumber}</span>}</th>
                        <td className={styles.dotCell}>
                          {canPlot && <span className={styles.dotTrack}>
                            <span className={styles.dotThreshold} style={{ left: thresholdPosition }} aria-hidden="true" />
                            {elapsed !== null && <button type="button" className={`${styles.dotButton} ${overdue ? "text-destructive" : "text-[var(--aging-blue)]"}`}
                              style={{ left: `${Math.max(0, elapsed) / DAY_MS / limit * 100}%` }} aria-pressed={pointId === item.id}
                              aria-label={`Consultar punto de ${item.code}, ${formatReinvoicingAge(elapsed)}`} title={formatReinvoicingAge(elapsed)} onClick={() => showPoint(item.id)}>
                              <motion.span className={styles.dot} aria-hidden="true" initial={reducedMotion ? false : { opacity: 0, scale: 0.45 }}
                                whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: reducedMotion ? 0 : 0.25 }} />
                            </button>}
                          </span>}
                        </td>
                        <td className="px-2 pt-2 text-right tabular-nums sm:px-3">
                          <span className={`block ${overdue ? "font-semibold text-destructive" : "text-foreground-muted"}`}>{elapsed === null ? "Sin fecha" : formatReinvoicingAge(elapsed)}</span>
                          <button type="button" className="inline-flex min-h-8 items-center gap-1 rounded-md text-xs font-semibold text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                            aria-label={`Ver detalle de ${item.code}`} onClick={() => showDispatch(item.id)}>Ver <ArrowRight aria-hidden="true" className="size-3.5" /></button>
                        </td>
                      </tr>;
                    })}
                  </tbody>
                </table>
                {total > PAGE_SIZE && <Pagination page={currentPage} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} itemLabel="despachos" ariaLabel="Paginación de despachos en refacturación" className="border-t border-border" />}
              </div>
            </section>
          )}
          <div ref={pointDetailRef} aria-live="polite">
            {detail && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/25 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{detail.code}{detail.orderNumber ? ` · Pedido ${detail.orderNumber}` : ""} <span className="text-xs font-normal text-foreground-muted">· {detail.programmingCode}</span></p>
                  <ul className="mt-1 text-xs leading-5 text-foreground-muted">{detail.requests.map(({ kind, startedAt }) => <li key={kind}>{kind} · {startedAt === null ? "Fecha no registrada" : `${formatReinvoicingAge(asOf - startedAt)} · Desde ${formatDashboardDateTime(new Date(startedAt).toISOString(), timezone)}`}</li>)}</ul>
                </div>
                <Link href={`/dispatches/${detail.id}`} prefetch={false} className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-xs font-semibold text-brand-strong hover:underline focus-visible:outline-2 focus-visible:outline-brand">Ver despacho <ArrowRight aria-hidden="true" className="size-3.5" /></Link>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
