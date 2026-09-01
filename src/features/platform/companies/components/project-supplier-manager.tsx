"use client";

import { Check, LoaderCircle, PackageSearch } from "lucide-react";
import { useActionState } from "react";

import { setProjectSuppliers } from "../actions";
import type { CompanyProject, CompanySupplier } from "../types";

const initialState = { status: "idle" as const };

export function ProjectSupplierManager({
  companyId,
  projects,
  suppliers,
}: {
  companyId: string;
  projects: CompanyProject[];
  suppliers: CompanySupplier[];
}) {
  if (!suppliers.length) {
    return (
      <div className="p-6 text-center sm:p-8">
        <PackageSearch className="mx-auto size-6 text-foreground-muted" />
        <p className="mt-3 text-sm font-semibold text-foreground">
          La empresa no tiene proveedores
        </p>
        <p className="mt-1 text-sm text-foreground-muted">
          Registra primero un proveedor para poder asignarlo a sus proyectos.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4 sm:p-6 lg:grid-cols-2 lg:p-8">
      {projects.map((project) => (
        <ProjectSupplierForm
          key={`${project.id}:${project.supplierIds.join(",")}`}
          companyId={companyId}
          project={project}
          suppliers={suppliers}
        />
      ))}
    </div>
  );
}

function ProjectSupplierForm({
  companyId,
  project,
  suppliers,
}: {
  companyId: string;
  project: CompanyProject;
  suppliers: CompanySupplier[];
}) {
  const [state, action, pending] = useActionState(setProjectSuppliers, initialState);

  return (
    <form action={action} className="rounded-xl border border-border bg-muted/25 p-4 sm:p-5">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="projectId" value={project.id} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">{project.name}</h3>
          <p className="mt-1 font-mono text-xs text-foreground-muted">{project.code}</p>
        </div>
        <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-semibold text-foreground-muted">
          {project.supplierIds.length} asignado(s)
        </span>
      </div>

      <fieldset className="mt-4 space-y-2" disabled={pending}>
        <legend className="sr-only">Proveedores disponibles</legend>
        {suppliers.map((supplier) => (
          <label
            key={supplier.id}
            className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2.5 ${
              supplier.active
                ? "cursor-pointer border-border bg-surface hover:border-brand/30"
                : "cursor-not-allowed border-border/60 bg-muted opacity-60"
            }`}
          >
            <input
              type="checkbox"
              name="supplierIds"
              value={supplier.id}
              defaultChecked={project.supplierIds.includes(supplier.id)}
              disabled={!supplier.active || pending}
              className="size-4 accent-[var(--color-brand)]"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">
                {supplier.name}
              </span>
              <span className="block font-mono text-[11px] text-foreground-muted">
                {supplier.code}
              </span>
            </span>
            {!supplier.active && (
              <span className="text-[10px] font-semibold text-foreground-muted">
                Inactivo
              </span>
            )}
          </label>
        ))}
      </fieldset>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p
          className={`text-xs ${
            state.status === "error" ? "text-destructive" : "text-success"
          }`}
          role={state.status === "error" ? "alert" : "status"}
        >
          {state.message}
        </p>
        <button type="submit" disabled={pending} className="primary-button shrink-0">
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          Guardar proveedores
        </button>
      </div>
    </form>
  );
}
