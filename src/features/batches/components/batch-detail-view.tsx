"use client";

import {
  ArrowLeft,
  ChevronRight,
  History,
  Plus,
  RotateCcw,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState } from "@/components/feedback/empty-state";
import { MotionPage } from "@/components/motion/motion-page";
import { MotionSection } from "@/components/motion/motion-section";
import type { ProjectSummary } from "@/features/projects/types";
import { formatStatusLabel } from "@/lib/status-labels";

import {
  formatBatchDate,
  formatBatchDateTime,
  formatBatchQuantity,
} from "../formatters";
import type {
  BatchDetail,
  BatchGuideRelation,
  BatchInvoice,
  BatchPermissions,
} from "../types";
import {
  AddGuideDialog,
  RemoveGuideDialog,
  RolloverDialog,
} from "./batch-dialogs";
import { BatchStatusBadge } from "./batch-status-badge";

function InvoiceState({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
        {label}
      </p>
      <p
        className={`mt-1 text-xs font-semibold ${value ? "text-foreground" : "text-foreground-muted"}`}
      >
        {value ?? "Sin factura"}
      </p>
    </div>
  );
}

function GuideCard({
  relation,
  productInvoice,
  timezone,
  canRemove,
  onRemove,
}: {
  relation: BatchGuideRelation;
  productInvoice?: BatchInvoice;
  timezone: string;
  canRemove: boolean;
  onRemove: () => void;
}) {
  return (
    <article className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-foreground">
              {relation.guideNumber}
            </h3>
            <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-semibold text-foreground-muted">
              {formatStatusLabel(relation.assignmentSource)}
            </span>
            <span className="rounded-full bg-brand-soft px-2 py-1 text-[10px] font-semibold text-brand-strong">
            {formatStatusLabel(relation.result, "Sin resultado")}
            </span>
          </div>
          <p className="mt-1 text-sm text-foreground-muted">
            {relation.supplierName} · {formatBatchDate(relation.guideDate)}
          </p>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-destructive/25 px-3 text-xs font-semibold text-destructive hover:bg-destructive-soft"
          >
            <Trash2 className="size-3.5" /> Remover guía
          </button>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-[10px] uppercase text-foreground-muted">
            Cantidad guía
          </p>
          <p className="mt-1 font-semibold">
            {formatBatchQuantity(relation.quantity)} {relation.unitCode}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-foreground-muted">
            Recibido físico
          </p>
          <p className="mt-1 font-semibold">
            {formatBatchQuantity(relation.receivedQuantity)} {relation.unitCode}
          </p>
        </div>
        <InvoiceState
          label="Factura PRODUCT"
          value={relation.productInvoiceStatus}
        />
        <InvoiceState
          label="Factura SERVICE"
          value={relation.serviceInvoiceStatus}
        />
      </div>
      {productInvoice && (
        <div className="mt-3 rounded-lg bg-muted/35 px-3 py-2 text-xs text-foreground-muted">
          PRODUCT {productInvoice.number}: cantidad factura agregada para{" "}
          {productInvoice.guideIds.length} guía(s){" "}
          <strong className="text-foreground">
            {formatBatchQuantity(productInvoice.invoiceQuantity)}{" "}
            {productInvoice.unitCode ?? ""}
          </strong>{" "}
          · diferencia agregada{" "}
          <strong
            className={
              productInvoice.difference === 0
                ? "text-success"
                : "text-destructive"
            }
          >
            {productInvoice.difference === null
              ? "UM no comparable"
              : formatBatchQuantity(productInvoice.difference)}
          </strong>
          {productInvoice.replacedByInvoiceId ? " · reemplazada" : ""}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3 border-t border-border pt-3 text-xs">
        <Link
          href={`/dispatches/${relation.dispatchId}`}
          className="font-semibold text-brand-strong hover:underline"
        >
          Ver Dispatch <ChevronRight className="inline size-3" />
        </Link>
        <Link
          href={`/programming/${relation.programmingId}`}
          className="font-semibold text-brand-strong hover:underline"
        >
          {relation.programmingCode} <ChevronRight className="inline size-3" />
        </Link>
        <span className="text-foreground-muted">
          Agregada {formatBatchDateTime(relation.addedAt, timezone)}
        </span>
      </div>
    </article>
  );
}

export function BatchDetailView({
  detail,
  project,
  permissions,
}: {
  detail: BatchDetail;
  project: ProjectSummary;
  permissions: BatchPermissions;
}) {
  const [addOpen, setAddOpen] = useState(false),
    [rolloverOpen, setRolloverOpen] = useState(false),
    [remove, setRemove] = useState<BatchGuideRelation | null>(null);
  const editable = detail.status === "DRAFT" || detail.status === "ASSEMBLING";
  return (
    <MotionPage className="mx-auto max-w-[1500px] space-y-5 pb-10">
      <MotionSection>
        <Link
          href="/batches"
          className="inline-flex items-center gap-2 text-sm font-semibold text-foreground-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Volver a lotes
        </Link>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
              Lote semanal
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {detail.code}
              </h1>
              <BatchStatusBadge status={detail.status} />
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground-muted">
                {formatStatusLabel(detail.source)}
              </span>
            </div>
            <p className="mt-2 text-sm text-foreground-muted">
              {formatBatchDate(detail.periodStart)} –{" "}
              {formatBatchDate(detail.periodEnd)} · Período contable{" "}
              {formatBatchDate(detail.accountingPeriod)}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {permissions.canAddGuide && editable && (
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="secondary-button gap-2"
              >
                <Plus className="size-4" /> Agregar guía
              </button>
            )}
            {permissions.canModify && detail.status === "ASSEMBLING" && (
              <button
                type="button"
                onClick={() => setRolloverOpen(true)}
                className="primary-button gap-2"
              >
                <RotateCcw className="size-4" /> Cerrar semana / Preparar
                siguiente
              </button>
            )}
          </div>
        </div>
      </MotionSection>
      <MotionSection className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["Pedidos completados", detail.orders.filter((order) => order.effectiveStatus === "COMPLETED").length],
          ["Pedidos pendientes", detail.orders.filter((order) => !["COMPLETED", "REINVOICING"].includes(order.effectiveStatus)).length],
          ["En refacturación", detail.orders.filter((order) => order.effectiveStatus === "REINVOICING").length],
          ["Guías activas", detail.activeGuideCount],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
        <div className="col-span-2 rounded-xl border border-border bg-surface p-4 lg:col-span-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
            Recibido por UM
          </p>
          <p className="mt-2 text-sm font-semibold">
            {detail.receivedByUnit.length
              ? detail.receivedByUnit
                  .map(
                    (row) =>
                      `${formatBatchQuantity(row.quantity)} ${row.unitCode}`,
                  )
                  .join(" · ")
              : "Sin cantidades"}
          </p>
        </div>
      </MotionSection>
      <MotionSection>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShoppingCart className="size-5 text-brand-strong" />
              <h2 className="font-semibold">Pedidos</h2>
            </div>
            <p className="mt-1 text-xs text-foreground-muted">
              Nivel principal de documentación y conciliación del lote.
            </p>
          </div>
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-strong">
            {detail.orders.length}
          </span>
        </div>
        {detail.orders.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {detail.orders.map((order) => (
              <article
                key={order.id}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
                      Pedido
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-foreground">
                      {order.orderNumber}
                    </h3>
                    <p className="mt-1 text-sm text-foreground-muted">
                      {order.supplierName}
                    </p>
                  </div>
                  <Link
                    href={`/batches/${detail.id}/orders/${order.id}`}
                    className="secondary-button gap-2"
                  >
                    Ver conciliación <ChevronRight className="size-4" />
                  </Link>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-6">
                  <DataCell label="Guías" value={order.guideCount} />
                  <DataCell
                    label="Cantidades"
                    value={
                      order.quantitiesByUnit.length
                        ? order.quantitiesByUnit
                            .map(
                              (row) =>
                                `${formatBatchQuantity(row.quantity)} ${row.unitCode}`,
                            )
                            .join(" · ")
                        : "Sin cantidades"
                    }
                  />
                  <DataCell label="PRODUCT" value={order.productInvoiceCount} />
                  <DataCell label="SERVICE" value={order.serviceInvoiceCount} />
                  <DataCell
                    label="Documentos"
                    value={formatStatusLabel(order.documentStatus)}
                  />
                  <DataCell
                    label="Estado del pedido"
                    value={formatStatusLabel(order.effectiveStatus)}
                  />
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Sin pedidos conciliables"
            description="Las guías activas necesitan número de pedido para formar el agregado de conciliación."
          />
        )}
      </MotionSection>
      <MotionSection>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Guías activas</h2>
            <p className="mt-1 text-xs text-foreground-muted">
              Movimientos físicos del lote, agrupados arriba por pedido.
            </p>
          </div>
          <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-strong">
            {detail.activeRelations.length}
          </span>
        </div>
        {detail.activeRelations.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {detail.activeRelations.map((relation) => (
              <GuideCard
                key={relation.relationId}
                relation={relation}
                productInvoice={detail.invoices.find(
                  (invoice) =>
                    invoice.type === "PRODUCT" &&
                    invoice.guideIds.includes(relation.guideId) &&
                    !["SUPERSEDED", "CANCELLED"].includes(invoice.status),
                )}
                timezone={project.timezone}
                canRemove={permissions.canModify && editable}
                onRemove={() => setRemove(relation)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            title="No hay guías activas"
            description="Agrega una guía despachada de esta semana o espera un rollover del sistema."
          />
        )}
      </MotionSection>
      <MotionSection className="rounded-xl border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <History className="size-4 text-brand-strong" />
          <div>
            <h2 className="font-semibold">Historial de relaciones removidas</h2>
            <p className="mt-1 text-xs text-foreground-muted">
              Las relaciones HUMAN y SYSTEM nunca se borran del historial
              operacional.
            </p>
          </div>
        </div>
        {detail.removedRelations.length ? (
          <div className="divide-y divide-border">
            {detail.removedRelations.map((relation) => (
              <div
                key={relation.relationId}
                className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[1fr_1fr_1fr_auto]"
              >
                <div>
                  <p className="font-semibold">{relation.guideNumber}</p>
                  <p className="mt-1 text-xs text-foreground-muted">
                    {relation.supplierName}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Retiro</p>
                  <p className="mt-1 font-semibold">
                    {formatStatusLabel(relation.removalSource ?? "HUMAN")} ·{" "}
                    {relation.removedAt
                      ? formatBatchDateTime(
                          relation.removedAt,
                          project.timezone,
                        )
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Motivo</p>
                  <p className="mt-1">
                    {relation.removalReason ?? "Sin motivo"}
                  </p>
                </div>
                <div className="self-center">
                  {relation.rolledToBatchId ? (
                    <Link
                      href={`/batches/${relation.rolledToBatchId}`}
                      className="text-xs font-semibold text-brand-strong hover:underline"
                    >
                      Ver destino
                    </Link>
                  ) : (
                    <span className="text-xs text-foreground-muted">
                      {relation.removedByName ?? "Sistema"}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-foreground-muted">
            Todavía no hay relaciones removidas.
          </p>
        )}
      </MotionSection>
      {addOpen && (
        <AddGuideDialog
          projectId={project.id}
          batchId={detail.id}
          guides={detail.eligibleGuides}
          onClose={() => setAddOpen(false)}
        />
      )}
      {remove && (
        <RemoveGuideDialog
          projectId={project.id}
          batchId={detail.id}
          relation={remove}
          onClose={() => setRemove(null)}
        />
      )}
      {rolloverOpen && (
        <RolloverDialog
          projectId={project.id}
          batchId={detail.id}
          preview={detail.preview}
          onClose={() => setRolloverOpen(false)}
        />
      )}
    </MotionPage>
  );
}

function DataCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted">
        {label}
      </dt>
      <dd className="mt-1 text-xs font-semibold text-foreground">{value}</dd>
    </div>
  );
}
