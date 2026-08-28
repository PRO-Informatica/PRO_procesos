"use client";

import { ArrowLeft, Building2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useActionState } from "react";

import { useGlobalPending } from "@/components/feedback/global-loading-provider";
import { MotionItem, MotionList } from "@/components/motion/motion-list";

import { createCompany } from "../actions";
import { initialCompanyActionState } from "../types";

export function CreateCompanyForm() {
  const [state, formAction, pending] = useActionState(
    createCompany,
    initialCompanyActionState,
  );
  useGlobalPending(
    pending,
    "Creando empresa…",
    "Estamos guardando la empresa y preparando su información inicial.",
  );

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-border bg-surface"
      aria-busy={pending}
    >
      <MotionList>
      <MotionItem className="border-b border-border p-6 sm:p-8">
        <span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-strong">
          <Building2 aria-hidden="true" className="size-5" />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">
          Nueva empresa
        </h1>
        <p className="mt-2 text-sm leading-6 text-foreground-muted">
          Crea la empresa con su información esencial. Iniciará con estado activo.
        </p>
      </MotionItem>

      <MotionItem className="space-y-5 p-6 sm:p-8">
        <div>
          <label htmlFor="company-name" className="form-label">
            Nombre
          </label>
          <input
            id="company-name"
            name="name"
            required
            minLength={2}
            maxLength={160}
            defaultValue={state.fields?.name}
            className="form-input"
            placeholder="Nombre legal o comercial"
            autoComplete="organization"
          />
        </div>

        <div>
          <label htmlFor="company-code" className="form-label">
            Código
          </label>
          <input
            id="company-code"
            name="code"
            required
            maxLength={40}
            defaultValue={state.fields?.code}
            className="form-input font-mono uppercase"
            placeholder="Ej. PRO-GT"
            aria-describedby="company-code-help"
          />
          <p id="company-code-help" className="mt-2 text-xs text-foreground-muted">
            El código debe ser único. La base de datos aplica su normalización oficial.
          </p>
        </div>

        <AnimatePresence initial={false}>
          {state.status === "error" && (
            <motion.p
              className="rounded-lg bg-destructive-soft px-4 py-3 text-sm text-destructive"
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              transition={{ duration: 0.16 }}
            >
              {state.message}
            </motion.p>
          )}
        </AnimatePresence>
      </MotionItem>

      <MotionItem className="flex flex-col-reverse gap-3 border-t border-border px-6 py-5 sm:flex-row sm:justify-between sm:px-8">
        <Link
          href="/platform/companies"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-foreground-muted hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Volver
        </Link>
        <motion.button
          type="submit"
          disabled={pending}
          className="primary-button min-w-36"
          whileTap={pending ? undefined : { scale: 0.98 }}
        >
          Crear empresa
        </motion.button>
      </MotionItem>
      </MotionList>
    </form>
  );
}
