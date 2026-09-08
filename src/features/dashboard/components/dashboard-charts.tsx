"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { motionTokens } from "@/lib/motion/tokens";
import { formatQuantity } from "../formatters";
import type { DashboardBatchReconciliation, DashboardWeekDay } from "../types";

const tooltipStyle = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  color: "var(--foreground)",
  fontSize: "0.75rem",
  boxShadow: "0 8px 24px rgb(16 24 40 / 10%)",
};

export function WeeklyVolumeChart({ days }: { days: DashboardWeekDay[] }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className="mt-4 h-60 w-full"
      style={{ fontFamily: "var(--font-sans)" }}
      role="img"
      aria-label="Volumen programado y recibido en metros cúbicos por día de la semana"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : motionTokens.duration.route }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={days} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
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
            maxBarSize={22}
            radius={[4, 4, 0, 0]}
            isAnimationActive={!reduceMotion}
            animationDuration={motionTokens.duration.progress * 1000}
            animationEasing="ease-out"
          />
          <Bar
            dataKey="receivedM3"
            fill="var(--foreground-muted)"
            maxBarSize={22}
            radius={[4, 4, 0, 0]}
            isAnimationActive={!reduceMotion}
            animationDuration={motionTokens.duration.progress * 1000}
            animationEasing="ease-out"
          />
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

const batchStatusSeries = [
  { key: "pendingInvoices", label: "Carga de factura", shortLabel: "Por cargar", color: "#d97706" },
  { key: "pendingReconciliation", label: "Pendiente de conciliación", shortLabel: "Por conciliar", color: "var(--brand)" },
  { key: "reinvoicing", label: "Refacturación", shortLabel: "Refacturación", color: "var(--destructive)" },
  { key: "reconciled", label: "Conciliados", shortLabel: "Conciliados", color: "var(--success)" },
] as const;

function BatchStatusStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "danger" | "success";
}) {
  return (
    <div
      className={`rounded-lg p-3 ${
        tone === "danger"
          ? "bg-destructive-soft text-destructive"
          : tone === "success"
            ? "bg-success-soft text-success"
            : "bg-muted text-foreground"
      }`}
    >
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-1 text-[11px] text-foreground-muted">{label}</p>
    </div>
  );
}

export function BatchReconciliationChart({
  batches,
}: {
  batches: DashboardBatchReconciliation[];
}) {
  const reduceMotion = useReducedMotion();
  const [selectedBatchId, setSelectedBatchId] = useState(
    () => batches.at(-1)?.batchId ?? "",
  );
  const selectedBatch =
    batches.find((batch) => batch.batchId === selectedBatchId) ?? batches.at(-1);

  if (!selectedBatch) {
    return (
      <div>
        <h2 className="font-semibold text-foreground">Conciliación por lote</h2>
        <div className="mt-5 grid min-h-52 place-items-center rounded-lg border border-dashed border-border bg-muted/25 px-4 text-center text-sm text-foreground-muted">
          Sin lotes disponibles para consultar.
        </div>
      </div>
    );
  }

  const statusData = batchStatusSeries.map((item) => ({
    name: item.shortLabel,
    fullName: item.label,
    value: selectedBatch[item.key],
    color: item.color,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-semibold text-foreground">Conciliación por lote</h2>
          <p className="mt-1 text-xs text-foreground-muted">
            Estados del lote seleccionado
          </p>
        </div>
        <label className="block sm:min-w-52">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
            Lote
          </span>
          <select
            value={selectedBatch.batchId}
            onChange={(event) => setSelectedBatchId(event.target.value)}
            className="min-h-10 w-full rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/15"
            aria-label="Seleccionar lote para la gráfica de conciliación"
          >
            {[...batches].reverse().map((batch) => (
              <option key={batch.batchId} value={batch.batchId}>
                {batch.batchCode}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        className="mt-4 h-56 w-full"
        role="img"
        aria-label={`${selectedBatch.batchCode}: ${total} despachos distribuidos por estado de conciliación`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={statusData}
            margin={{ top: 8, right: 4, left: -18, bottom: 0 }}
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
              maxBarSize={38}
              radius={[5, 5, 0, 0]}
              isAnimationActive={!reduceMotion}
              animationDuration={motionTokens.duration.progress * 1000}
              animationEasing="ease-out"
            >
              {statusData.map((item) => (
                <Cell key={item.fullName} fill={item.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <BatchStatusStat label="Por cargar factura" value={selectedBatch.pendingInvoices} />
        <BatchStatusStat label="Por conciliar" value={selectedBatch.pendingReconciliation} />
        <BatchStatusStat label="Refacturación" value={selectedBatch.reinvoicing} tone="danger" />
        <BatchStatusStat label="Conciliados" value={selectedBatch.reconciled} tone="success" />
      </div>
    </motion.div>
  );
}
