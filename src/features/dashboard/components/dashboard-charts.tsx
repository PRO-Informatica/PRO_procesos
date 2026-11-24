"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";
import Link from "next/link";
import { motion, useInView, useReducedMotion } from "motion/react";
import { useId, useRef } from "react";
import { motionTokens } from "@/lib/motion/tokens";
import { formatQuantity } from "../formatters";
import { dashboardDetailHref } from "../details";
import type { DashboardReconciliationTotals, DashboardWeekDay } from "../types";
import styles from "./dashboard-charts.module.css";

const tooltipStyle = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  color: "var(--foreground)",
  fontSize: "0.75rem",
  boxShadow: "0 8px 24px rgb(16 24 40 / 10%)",
};

function LinkedBar({ x, y, width, height, fill, index, href, label }: BarShapeProps & { href: string; label: string }) {
  const reduceMotion = useReducedMotion();
  const rectRef = useRef<SVGRectElement>(null);
  const visible = useInView(rectRef, { margin: "40px" });
  const gradientId = `bar-sheen-${useId().replaceAll(":", "")}`;
  if (width <= 0) return <g />;
  const geometry = reduceMotion || visible ? { y, height } : { y: y + height, height: 0 };
  const initial = reduceMotion ? false : { y: y + height, height: 0 };
  const transition = reduceMotion ? { duration: 0 } : { type: "spring" as const, stiffness: 115, damping: 22, mass: 0.8, delay: index * 0.045 };
  return <Link href={href} prefetch={false} className={styles.barLink} aria-label={label}>
    <title>{label}</title>
    <defs><motion.linearGradient id={gradientId} x1="0" x2="0" y1="-1" y2="0"
      animate={visible && !reduceMotion ? { y1: [-1, 1], y2: [0, 2] } : { y1: -1, y2: 0 }}
      transition={{ duration: 4.5, repeat: Infinity, repeatDelay: 1.5, ease: "linear", delay: index * 0.18 }}>
      <stop offset="0" stopColor="white" stopOpacity="0" /><stop offset="0.5" stopColor="white" stopOpacity="0.22" /><stop offset="1" stopColor="white" stopOpacity="0" />
    </motion.linearGradient></defs>
    <motion.rect x={x} width={width} rx={5} fill={fill} initial={initial} animate={geometry} transition={transition} className={styles.barBody} />
    {!reduceMotion && <motion.rect x={x} width={width} rx={5} fill={`url(#${gradientId})`} initial={initial} animate={geometry} transition={transition} className={styles.barSheen} aria-hidden="true" />}
    <rect ref={rectRef} x={x} y={y} width={width} height={height} rx={5} fill="transparent" />
  </Link>;
}

export function WeeklyVolumeChart({ days, projectId }: { days: DashboardWeekDay[]; projectId: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="mt-4 w-full"
      style={{ fontFamily: "var(--font-sans)" }}
      role="group"
      aria-label="Volumen programado y recibido en metros cúbicos por día de la semana"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : motionTokens.duration.route }}
    >
      <div className="h-60 w-full"><ResponsiveContainer width="100%" height="100%">
        <BarChart data={days} margin={{ top: 22, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="shortLabel"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--foreground-muted)", fontSize: 10, fontWeight: 600 }}
            tickFormatter={(value: string) => value.toUpperCase()}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--foreground-muted)", fontSize: 10 }}
            tickFormatter={(value: number) => formatQuantity(value)}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={tooltipStyle}
            labelFormatter={(label) => String(label).toUpperCase()}
            formatter={(value, name) => [
              `${formatQuantity(Number(value))} M3`,
              name === "programmedM3" ? "Programado" : "Recibido",
            ]}
          />
          <Bar
            dataKey="programmedM3"
            fill="var(--brand)"
            maxBarSize={28}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            shape={(props: BarShapeProps) => <LinkedBar {...props} href={dashboardDetailHref(projectId, "programmedDay", { date: days[props.index].date })} label={`Ver programaciones del ${days[props.index].date}: ${formatQuantity(days[props.index].programmedM3)} M3`} />}
          ><LabelList dataKey="programmedM3" position="top" offset={8} fill="var(--foreground-muted)" fontSize={10} formatter={(value) => Number(value) > 0 ? Number(value).toLocaleString("es-GT", { maximumFractionDigits: 2 }) : ""} /></Bar>
          <Bar
            dataKey="receivedM3"
            fill="var(--foreground-muted)"
            maxBarSize={28}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
            shape={(props: BarShapeProps) => <LinkedBar {...props} href={dashboardDetailHref(projectId, "receivedDay", { date: days[props.index].date })} label={`Ver guías del ${days[props.index].date}: ${formatQuantity(days[props.index].receivedM3)} M3 recibidos`} />}
          ><LabelList dataKey="receivedM3" position="top" offset={8} fill="var(--foreground-muted)" fontSize={10} formatter={(value) => Number(value) > 0 ? Number(value).toLocaleString("es-GT", { maximumFractionDigits: 2 }) : ""} /></Bar>
        </BarChart>
      </ResponsiveContainer></div>
      <details className="mt-3 text-xs text-foreground-muted">
        <summary className="w-fit cursor-pointer rounded py-2 font-medium focus-visible:outline-2 focus-visible:outline-brand">Ver registros por día</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{days.map((day) => <div key={day.date} className="rounded-lg border border-border p-2">
          <p className="font-semibold uppercase">{day.shortLabel} · {day.date.slice(8)}/{day.date.slice(5, 7)}</p>
          <Link href={dashboardDetailHref(projectId, "programmedDay", { date: day.date })} className="flex min-h-11 items-center justify-between gap-2 hover:text-brand-strong">Programado <span>{formatQuantity(day.programmedM3)} M3</span></Link>
          <Link href={dashboardDetailHref(projectId, "receivedDay", { date: day.date })} className="flex min-h-11 items-center justify-between gap-2 hover:text-brand-strong">Recibido <span>{formatQuantity(day.receivedM3)} M3</span></Link>
        </div>)}</div>
      </details>
    </motion.div>
  );
}

const reconciliationStatusSeries = [
  { key: "pendingInvoices", label: "Carga de factura", shortLabel: "Por cargar" },
  { key: "pendingReconciliation", label: "Pendiente de conciliación", shortLabel: "Por conciliar" },
  { key: "reinvoicing", label: "Refacturación", shortLabel: "Refacturación" },
  { key: "reconciled", label: "Conciliados", shortLabel: "Conciliados" },
] as const;

function ReconciliationStatusStat({
  label,
  value,
  tone = "default",
  href,
}: {
  label: string;
  value: number;
  tone?: "default" | "danger" | "success";
  href: string;
}) {
  return (
    <Link href={href} aria-label={`Ver ${value} despachos: ${label}`} prefetch={false}
      className={`rounded-lg p-3 transition hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
        tone === "danger"
          ? "bg-destructive-soft text-destructive"
          : tone === "success"
            ? "bg-success-soft text-success"
            : "bg-muted text-foreground"
      }`}
    >
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-1 text-[11px] text-foreground-muted">{label}</p>
    </Link>
  );
}

export function ProjectReconciliationChart({
  totals,
  projectId,
  projectName,
}: {
  totals: DashboardReconciliationTotals;
  projectId: string;
  projectName: string;
}) {
  const reduceMotion = useReducedMotion();
  const statusData = reconciliationStatusSeries.map((item) => ({
    name: item.shortLabel,
    fullName: item.label,
    value: totals[item.key],
    href: dashboardDetailHref(projectId, item.key),
  }));
  const total = statusData.reduce((sum, item) => sum + item.value, 0);

  return (
    <motion.div
      className="w-full"
      style={{ fontFamily: "var(--font-sans)" }}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : motionTokens.duration.route }}
    >
      <h2 className="font-semibold text-foreground">Conciliación por proyecto</h2>
      <p className="mt-1 text-xs text-foreground-muted">
        Estados de los despachos del proyecto
      </p>

      {total === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/25 p-4 text-sm text-foreground-muted">Este proyecto aún no tiene despachos.</p>
      ) : <div
        className="mt-4 h-56 w-full"
        role="group"
        aria-label={`${projectName}: ${total} despachos distribuidos por estado de conciliación`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={statusData}
            margin={{ top: 24, right: 8, left: -18, bottom: 0 }}
          >
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              interval={0}
              tick={{ fill: "var(--foreground-muted)", fontSize: 9, fontWeight: 600 }}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--foreground-muted)", fontSize: 10 }}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              contentStyle={tooltipStyle}
              labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? "Estado"}
              formatter={(value) => [Number(value), "Despachos"]}
            />
            <Bar
              dataKey="value"
              fill="var(--brand)"
              maxBarSize={42}
              radius={[5, 5, 0, 0]}
              isAnimationActive={false}
              shape={(props: BarShapeProps) => <LinkedBar {...props} href={statusData[props.index].href} label={`Ver ${statusData[props.index].value} despachos en ${statusData[props.index].fullName} de ${projectName}`} />}
            >
              <LabelList dataKey="value" position="top" offset={9} fill="var(--foreground)" fontSize={12} fontWeight={600} formatter={(value) => Number(value) > 0 ? value : ""} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <ReconciliationStatusStat label="Por cargar factura" value={totals.pendingInvoices} href={statusData[0].href} />
        <ReconciliationStatusStat label="Por conciliar" value={totals.pendingReconciliation} href={statusData[1].href} />
        <ReconciliationStatusStat label="Refacturación" value={totals.reinvoicing} tone="danger" href={statusData[2].href} />
        <ReconciliationStatusStat label="Conciliados" value={totals.reconciled} tone="success" href={statusData[3].href} />
      </div>
      <Link href={dashboardDetailHref(projectId, "orders")} className="secondary-button mt-4 w-full text-xs">Ver despachos del proyecto</Link>
    </motion.div>
  );
}
