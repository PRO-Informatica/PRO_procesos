"use client";

import {
  FileCheck2,
  ReceiptText,
  RefreshCcw,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { DocumentActions } from "@/components/documents/document-preview-dialog";
import { MotionPage } from "@/components/motion/motion-page";
import { getInvoiceDownloadUrl } from "@/features/batches/actions";
import {
  formatBatchDate,
  formatBatchQuantity,
} from "@/features/batches/formatters";
import type { ProjectSummary } from "@/features/projects/types";
import { formatStatusLabel } from "@/lib/status-labels";

import type { GlobalInvoiceData } from "../types";

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
export function InvoicesWorkspace({
  project,
  data,
}: {
  project: ProjectSummary;
  data: GlobalInvoiceData;
}) {
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [date, setDate] = useState("");
  const [replacement, setReplacement] = useState("");
  const statuses = [...new Set(data.items.map((item) => item.status))].sort();
  const filtered = useMemo(
    () =>
      data.items.filter((item) => {
        const term = query.trim().toLowerCase();
        return (
          (!term ||
            [
              item.number,
              item.orderNumber,
              item.pcaOriginal,
              item.supplierName,
            ].some((value) => value?.toLowerCase().includes(term))) &&
          (!batch || item.batchId === batch) &&
          (!type || item.type === type) &&
          (!status || item.status === status) &&
          (!date || item.date === date) &&
          (!replacement ||
            (replacement === "YES"
              ? Boolean(item.replacesInvoiceId || item.replacedByInvoiceId)
              : !item.replacesInvoiceId && !item.replacedByInvoiceId))
        );
      }),
    [data.items, query, batch, type, status, date, replacement],
  );
  return (
    <MotionPage className="mx-auto max-w-[1600px] space-y-5 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
          Gestión global · {project.name}
        </p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">Facturas</h1>
        <p className="mt-2 text-sm text-foreground-muted">
          Consulta documental global. La carga y conciliación se trabajan desde
          el despacho dentro de su lote.
        </p>
      </header>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-7">
        <Metric label="Total" value={data.items.length} />
        <Metric
          label="Producto"
          value={data.items.filter((i) => i.type === "PRODUCT").length}
        />
        <Metric
          label="Servicio"
          value={data.items.filter((i) => i.type === "SERVICE").length}
        />
        <Metric
          label="Confirmadas"
          value={
            data.items.filter((i) => i.extractionStatus === "CONFIRMED").length
          }
        />
        <Metric
          label="Corregidas"
          value={
            data.items.filter((i) => i.extractionStatus === "CORRECTED").length
          }
        />
        <Metric
          label="Reemplazos"
          value={data.items.filter((i) => i.replacesInvoiceId).length}
        />
        <Metric
          label="Pendientes/revisión"
          value={
            data.items.filter(
              (i) =>
                i.extractionStatus === "PENDING" ||
                ["REGISTERED", "NON_PROCEEDING"].includes(i.status),
            ).length
          }
        />
      </section>
      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="relative xl:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-3 size-4 text-foreground-muted" />
            <input
              aria-label="Buscar facturas"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Factura, Pedido, PCA o proveedor"
              className="form-input pl-9"
            />
          </label>
          <select
            aria-label="Filtrar por lote"
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
            aria-label="Filtrar por tipo"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="form-input"
          >
            <option value="">Producto / Servicio</option>
            <option value="PRODUCT">Producto</option>
            <option value="SERVICE">Servicio</option>
          </select>
          <select
            aria-label="Filtrar por estado"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="form-input"
          >
            <option value="">Todos los estados</option>
            {statuses.map((s) => (
              <option key={s} value={s}>{formatStatusLabel(s)}</option>
            ))}
          </select>
          <input
            aria-label="Filtrar por fecha"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="form-input"
          />
          <select
            aria-label="Filtrar reemplazos"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            className="form-input"
          >
            <option value="">Reemplazos: todos</option>
            <option value="YES">Con reemplazo</option>
            <option value="NO">Sin reemplazo</option>
          </select>
          <p className="self-center text-xs text-foreground-muted xl:col-span-5">
            Proyecto: {project.name}. Cámbialo desde el selector global.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setBatch("");
              setType("");
              setStatus("");
              setDate("");
              setReplacement("");
            }}
            className="secondary-button text-xs"
          >
            <RefreshCcw className="size-3.5" /> Limpiar
          </button>
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[1200px] text-left text-sm">
            <thead className="bg-muted/60 text-[10px] uppercase text-foreground-muted">
              <tr>
                <th className="p-4">Factura</th>
                <th className="p-4">Pedido / lote</th>
                <th className="p-4">Proveedor</th>
                <th className="p-4">PCA</th>
                <th className="p-4">Tipo</th>
                <th className="p-4">Estado</th>
                <th className="p-4">Extracción</th>
                <th className="p-4">Fecha / total</th>
                <th className="p-4">Documento</th>
                <th className="p-4">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td className="p-4">
                    <strong>{item.number}</strong>
                    <p className="text-xs text-foreground-muted">
                      {item.createdByName}
                    </p>
                  </td>
                  <td className="p-4">
                    {item.orderNumber ?? "—"}
                    <p className="text-xs text-foreground-muted">
                      {item.batchCode ?? "Sin lote"}
                    </p>
                  </td>
                  <td className="p-4">{item.supplierName}</td>
                  <td className="p-4 font-mono text-xs">
                    {item.pcaOriginal ?? "—"}
                  </td>
                  <td className="p-4">{formatStatusLabel(item.type)}</td>
                  <td className="p-4">{formatStatusLabel(item.status)}</td>
                  <td className="p-4">{formatStatusLabel(item.extractionStatus)}</td>
                  <td className="p-4">
                    {formatBatchDate(item.date)}
                    <p className="text-xs">
                      {item.currency} {formatBatchQuantity(item.total)}
                    </p>
                  </td>
                  <td className="p-4">{item.fileName ?? "Sin PDF"}</td>
                  <td className="p-4">
                    <div className="flex gap-2">
                      {item.dispatchId && (
                        <Link
                          href={`/dispatches/${item.dispatchId}`}
                          className="secondary-button text-xs"
                        >
                          Ver despacho
                        </Link>
                      )}
                      {item.documentId && item.fileName && (
                        <DocumentActions projectId={project.id} documentId={item.documentId} fileName={item.fileName} mimeType="application/pdf" getSignedUrl={getInvoiceDownloadUrl} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 p-4 lg:hidden">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-border p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong>
                    {formatStatusLabel(item.type)} · {item.number}
                  </strong>
                  <p className="mt-1 text-xs text-foreground-muted">
                    Pedido {item.orderNumber ?? "—"} ·{" "}
                    {item.batchCode ?? "Sin lote"}
                  </p>
                </div>
                <ReceiptText className="size-5 text-brand-strong" />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-foreground-muted">Proveedor</dt>
                  <dd>{item.supplierName}</dd>
                </div>
                <div>
                  <dt className="text-foreground-muted">PCA</dt>
                  <dd>{item.pcaOriginal ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-foreground-muted">Estado</dt>
                  <dd>{formatStatusLabel(item.status)}</dd>
                </div>
                <div>
                  <dt className="text-foreground-muted">Extracción</dt>
                  <dd>{formatStatusLabel(item.extractionStatus)}</dd>
                </div>
              </dl>
              <div className="mt-4 flex gap-2">
                {item.dispatchId && (
                  <Link
                    href={`/dispatches/${item.dispatchId}`}
                    className="primary-button text-xs"
                  >
                    Ver despacho
                  </Link>
                )}
                {item.documentId && item.fileName && (
                  <DocumentActions projectId={project.id} documentId={item.documentId} fileName={item.fileName} mimeType="application/pdf" getSignedUrl={getInvoiceDownloadUrl} />
                )}
              </div>
            </article>
          ))}
          {!filtered.length && (
            <EmptyState
              icon={FileCheck2}
              title="Sin facturas para estos filtros"
              description="Ajusta los filtros o carga una factura desde un lote."
            />
          )}
        </div>
      </section>
    </MotionPage>
  );
}
