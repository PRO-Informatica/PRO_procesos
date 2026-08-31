import {
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  Eye,
  Hash,
  Layers3,
  Plus,
  UserRound,
} from "lucide-react";
import Link from "next/link";

import { MotionSection } from "@/components/motion/motion-section";

const products = [
  {
    quantity: "8.000",
    unit: "M3",
    code: "CONC-4000",
    description: "Concreto 4000 PSI",
  },
  {
    quantity: "2.000",
    unit: "M3",
    code: "CONC-5000",
    description: "Concreto 5000 PSI",
  },
];

function PreviewField({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground-muted">
        {label}
      </p>
      <div className="mt-2 flex min-h-11 items-center rounded-lg border border-border bg-background px-3.5 text-sm font-medium text-foreground shadow-xs">
        {value}
      </div>
    </div>
  );
}

export function DispatchGuideTemplatePreview() {
  return (
    <div className="mx-auto max-w-[1440px]">
      <MotionSection>
        <Link
          href="/platform/templates"
          className="inline-flex items-center gap-2 text-xs font-semibold text-foreground-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Volver a plantillas
        </Link>

        <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
                Plantilla predeterminada
              </p>
              <span className="rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-semibold text-success">
                Activa
              </span>
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
              Guía de despacho
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
              Vista administrativa de la información que se solicitará al registrar una guía.
            </p>
          </div>

          <div className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-foreground-muted">
            <Eye aria-hidden="true" className="size-4 text-brand-strong" />
            Preview · No registra despachos
          </div>
        </div>
      </MotionSection>

      <MotionSection className="mt-6 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="flex flex-col gap-4 border-b border-border bg-muted/35 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
              <ClipboardList aria-hidden="true" className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Guía de despacho</h2>
              <p className="mt-0.5 text-xs text-foreground-muted">Ejemplo visual de la plantilla</p>
            </div>
          </div>
          <span className="w-fit rounded-full border border-border bg-surface px-3 py-1.5 text-[11px] font-semibold text-foreground-muted">
            Predeterminada
          </span>
        </div>

        <div className="space-y-8 p-5 sm:p-6 lg:p-8">
          <section aria-labelledby="general-heading">
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground-muted">
                <Hash aria-hidden="true" className="size-4" />
              </span>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-strong">
                  Sección general
                </p>
                <h2 id="general-heading" className="mt-0.5 text-sm font-semibold text-foreground">
                  Información de la guía
                </h2>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="relative">
                <PreviewField label="Guía de despacho" value="GD-000001" />
                <ClipboardList aria-hidden="true" className="pointer-events-none absolute bottom-3.5 right-3.5 size-4 text-foreground-muted" />
              </div>
              <div className="relative">
                <PreviewField label="Fecha" value="29/08/2026" />
                <CalendarDays aria-hidden="true" className="pointer-events-none absolute bottom-3.5 right-3.5 size-4 text-foreground-muted" />
              </div>
              <div className="relative">
                <PreviewField label="Persona que recibe" value="Juan Pérez" />
                <UserRound aria-hidden="true" className="pointer-events-none absolute bottom-3.5 right-3.5 size-4 text-foreground-muted" />
              </div>
            </div>
          </section>

          <section aria-labelledby="products-heading" className="border-t border-border pt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-foreground-muted">
                  <Layers3 aria-hidden="true" className="size-4" />
                </span>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-strong">
                    Sección productos · Repetible
                  </p>
                  <h2 id="products-heading" className="mt-0.5 text-sm font-semibold text-foreground">
                    Productos despachados
                  </h2>
                </div>
              </div>
              <p className="text-xs text-foreground-muted">Una guía puede incluir múltiples líneas.</p>
            </div>

            <div className="mt-4 space-y-4">
              {products.map((product, index) => (
                <article
                  key={product.code}
                  className="rounded-xl border border-border bg-muted/25 p-4 sm:p-5"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">Producto {index + 1}</h3>
                    <span className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-semibold text-foreground-muted ring-1 ring-inset ring-border">
                      Línea {index + 1}
                    </span>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[0.75fr_0.55fr_1.15fr_2fr]">
                    <PreviewField label="Cantidad" value={product.quantity} />
                    <PreviewField label="UM" value={product.unit} />
                    <PreviewField label="Código producto" value={product.code} />
                    <PreviewField label="Descripción producto" value={product.description} />
                  </div>
                </article>
              ))}
            </div>

            <div
              aria-disabled="true"
              className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 text-sm font-semibold text-foreground-muted"
            >
              <Plus aria-hidden="true" className="size-4" />
              Agregar producto
              <span className="sr-only">Disponible en el futuro formulario operativo</span>
            </div>
          </section>
        </div>

        <div className="border-t border-border bg-muted/30 px-5 py-4 sm:px-6 lg:px-8">
          <p className="flex items-start gap-2 text-xs leading-5 text-foreground-muted">
            <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-strong" />
            Esta representación explica la estructura global. El registro real se realizará en el
            flujo operativo de despachos y seguirá sujeto a permisos de proyecto.
          </p>
        </div>
      </MotionSection>
    </div>
  );
}
