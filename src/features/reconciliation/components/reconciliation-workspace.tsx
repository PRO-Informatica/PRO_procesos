"use client";

import { Search, Scale } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { formatBatchQuantity } from "@/features/batches/formatters";
import type { ProjectSummary } from "@/features/projects/types";
import { formatStatusLabel } from "@/lib/status-labels";
import type { GlobalReconciliationData } from "../types";

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase text-foreground-muted">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
const label = (value: string) => formatStatusLabel(value);

export function ReconciliationWorkspace({
  project,
  data,
}: {
  project: ProjectSummary;
  data: GlobalReconciliationData;
}) {
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("");
  const [status, setStatus] = useState("");
  const [supplier, setSupplier] = useState("");
  const statuses = [
    ...new Set(data.items.map((item) => item.reconciliationStatus)),
  ].sort();
  const suppliers = [
    ...new Set(data.items.map((item) => item.supplierName)),
  ].sort();
  const filtered = useMemo(
    () =>
      data.items.filter(
        (item) =>
          (!query ||
            item.orderNumber.toLowerCase().includes(query.toLowerCase())) &&
          (!batch || item.batchId === batch) &&
          (!status || item.reconciliationStatus === status) &&
          (!supplier || item.supplierName === supplier),
      ),
    [data.items, query, batch, status, supplier],
  );
  return (
    <MotionPage className="mx-auto max-w-[1600px] space-y-5 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
          Control global · {project.name}
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Conciliación por Pedido
        </h1>
        <p className="mt-2 text-sm text-foreground-muted">
          Resumen global derivado de reconciliation_orders. El trabajo detallado
          permanece dentro del Pedido.
        </p>
      </header>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Metric label="Pedidos" value={data.items.length} />
        <Metric
          label="Conciliados"
          value={
            data.items.filter((i) => i.reconciliationStatus === "MATCHED")
              .length
          }
        />
        <Metric
          label="Parciales"
          value={
            data.items.filter((i) => i.reconciliationStatus === "PARTIAL")
              .length
          }
        />
        <Metric
          label="Con diferencias"
          value={
            data.items.filter(
              (i) => i.reconciliationStatus === "WITH_DIFFERENCES",
            ).length
          }
        />
        <Metric
          label="Sin facturas"
          value={
            data.items.filter((i) => i.reconciliationStatus === "NO_INVOICES")
              .length
          }
        />
        <Metric
          label="Requieren revisión"
          value={
            data.items.filter(
              (i) => i.reconciliationStatus === "REQUIRES_REVIEW",
            ).length
          }
        />
      </section>
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-foreground-muted" />
            <input
              aria-label="Buscar Pedido"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar Pedido"
              className="form-input pl-9"
            />
          </label>
          <select
            aria-label="Filtrar lote"
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            className="form-input"
          >
            <option value="">Todos los lotes</option>
            {data.batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.code}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar estado"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="form-input"
          >
            <option value="">Todos los estados</option>
            {statuses.map((s) => (
              <option key={s}>{label(s)}</option>
            ))}
          </select>
          <select
            aria-label="Filtrar proveedor"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="form-input"
          >
            <option value="">Todos los proveedores</option>
            {suppliers.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </section>
      <section className="grid gap-3">
        {filtered.map((item) => (
          <article
            key={item.id}
            className="rounded-xl border border-border bg-surface p-4 sm:p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase text-foreground-muted">
                  {item.batchCode}
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  Pedido {item.orderNumber}
                </h2>
                <p className="mt-1 text-sm text-foreground-muted">
                  {item.supplierName}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
                <div>
                  <dt className="text-xs text-foreground-muted">Guides</dt>
                  <dd className="font-semibold">{item.guideCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-foreground-muted">Invoices</dt>
                  <dd className="font-semibold">{item.invoiceCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-foreground-muted">Documental</dt>
                  <dd className="font-semibold">
                    {label(item.documentStatus)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-foreground-muted">
                    Conciliación
                  </dt>
                  <dd className="font-semibold">
                    {label(item.reconciliationStatus)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-foreground-muted">
                    Diferencia absoluta
                  </dt>
                  <dd className="font-semibold">
                    {formatBatchQuantity(item.difference)}{" "}
                    {item.differenceUnits.join("/")}
                  </dd>
                </div>
              </dl>
              <Link
                href={`/batches/${item.batchId}/orders/${item.id}`}
                className="primary-button"
              >
                Ver conciliación
              </Link>
            </div>
          </article>
        ))}
        {!filtered.length && (
          <EmptyState
            icon={Scale}
            title="Sin conciliaciones para estos filtros"
            description="Ajusta los filtros o abre un lote para revisar sus Pedidos."
          />
        )}
      </section>
    </MotionPage>
  );
}
