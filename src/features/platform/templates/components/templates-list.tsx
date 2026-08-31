import { ArrowRight, ClipboardList, Layers3, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { MotionSection } from "@/components/motion/motion-section";

export function TemplatesList() {
  return (
    <div className="mx-auto max-w-[1440px]">
      <MotionSection>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-strong">
          Administración global
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
          Plantillas
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-muted">
          Consulta las definiciones predeterminadas que utiliza la operación. En esta fase son
          referencias administrativas de solo lectura.
        </p>
      </MotionSection>

      <MotionSection className="mt-6">
        <article className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          <div className="grid gap-6 p-6 sm:p-7 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-soft text-brand-strong">
              <ClipboardList aria-hidden="true" className="size-6" />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">Guía de despacho</h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand-strong">
                  <ShieldCheck aria-hidden="true" className="size-3.5" />
                  Predeterminada
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-semibold text-success">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                  Activa
                </span>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-foreground-muted">
                Formulario predeterminado utilizado para registrar la información general de una
                guía y sus productos despachados.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-foreground-muted">
                <span className="inline-flex items-center gap-2">
                  <Layers3 aria-hidden="true" className="size-4" />
                  Productos repetibles
                </span>
                <span>Definición global</span>
                <span>Solo lectura</span>
              </div>
            </div>

            <Link
              href="/platform/templates/dispatch-guide"
              className="primary-button w-full shrink-0 gap-2 sm:w-fit"
            >
              Ver plantilla
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </div>
        </article>
      </MotionSection>
    </div>
  );
}
