"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion, useReducedMotion } from "motion/react";
import { motionTokens } from "@/lib/motion/tokens";
import { formatQuantity } from "../formatters";
import type { DashboardWeekDay } from "../types";

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

type OrderDistribution = {
  pending: number;
  completed: number;
  reinvoicing: number;
};

export function OrderStatusChart({ orders }: { orders: OrderDistribution }) {
  const reduceMotion = useReducedMotion();
  const data = [
    { name: "Completados", value: orders.completed, color: "var(--success)" },
    { name: "Pendientes", value: orders.pending, color: "var(--brand)" },
    { name: "Refacturación", value: orders.reinvoicing, color: "var(--destructive)" },
  ];
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <motion.div
      className="relative mx-auto mt-5 h-44 w-full max-w-64"
      style={{ fontFamily: "var(--font-sans)" }}
      role="img"
      aria-label={`${total} pedidos: ${orders.completed} completados, ${orders.pending} pendientes y ${orders.reinvoicing} en refacturación`}
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduceMotion ? 0 : motionTokens.duration.route }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={48}
            outerRadius={72}
            paddingAngle={total > 0 ? 2 : 0}
            stroke="var(--surface)"
            strokeWidth={2}
            isAnimationActive={!reduceMotion}
            animationDuration={motionTokens.duration.progress * 1000}
            animationEasing="ease-out"
          >
            {data.map((item) => (
              <Cell key={item.name} fill={item.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value) => [Number(value), "Pedidos"]}
          />
          <text
            x="50%"
            y="48%"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--foreground)"
            fontSize="24"
            fontWeight="600"
          >
            {total}
          </text>
          <text
            x="50%"
            y="61%"
            textAnchor="middle"
            dominantBaseline="middle"
            fill="var(--foreground-muted)"
            fontSize="10"
          >
            Pedidos
          </text>
        </PieChart>
      </ResponsiveContainer>
    </motion.div>
  );
}
