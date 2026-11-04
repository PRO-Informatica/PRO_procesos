"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export function ProjectAddressFields({
  address = "",
  additionalAddresses = [],
  pending = false,
}: {
  address?: string | null;
  additionalAddresses?: readonly string[];
  pending?: boolean;
}) {
  const id = useId();
  const nextId = useRef(additionalAddresses.length + 1);
  const container = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<number | "add" | null>(null);
  const [rows, setRows] = useState(() => [
    { key: 0, value: address ?? "" },
    ...additionalAddresses.map((value, index) => ({ key: index + 1, value })),
  ]);

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === "add") container.current?.querySelector<HTMLButtonElement>("[data-add-address]")?.focus();
    else if (target !== null) document.getElementById(`${id}-${target}`)?.focus();
  }, [rows, id]);

  function addAddress() {
    const key = nextId.current++;
    focusTarget.current = key;
    setRows((current) => [...current, { key, value: "" }]);
  }

  function removeAddress(key: number) {
    focusTarget.current = "add";
    setRows((current) => current.filter((row) => row.key !== key));
  }

  return (
    <div ref={container} className="min-w-0 space-y-3 sm:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="form-label mb-0">Direcciones de la obra *</p>
        <button type="button" className="secondary-button min-h-10 gap-1.5 text-sm" onClick={addAddress} disabled={pending} data-add-address>
          <Plus aria-hidden="true" className="size-4 shrink-0" />
          Agregar dirección
        </button>
      </div>
      <p id={`${id}-hint`} className="text-xs leading-5 text-foreground-muted">
        El Excel y las facturas pueden coincidir con cualquiera de estas direcciones.
      </p>
      {rows.map((row, index) => (
        <div key={row.key} className="min-w-0 rounded-xl border border-border bg-muted/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label htmlFor={`${id}-${row.key}`} className="text-sm font-medium">
              Dirección {index + 1}{index === 0 ? " (principal)" : ""} *
            </label>
            {index > 0 ? (
              <button type="button" className="icon-button size-10 shrink-0" onClick={() => removeAddress(row.key)} disabled={pending} aria-label={`Eliminar dirección ${index + 1}`}>
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            ) : null}
          </div>
          <textarea
            id={`${id}-${row.key}`}
            name={index === 0 ? "address" : "additionalAddress"}
            value={row.value}
            onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, value: event.target.value } : item))}
            required minLength={5} maxLength={300} rows={2}
            readOnly={pending}
            aria-describedby={`${id}-hint`}
            className="form-input min-h-20 w-full min-w-0 resize-y"
            placeholder="Dirección que aparece en la solicitud o como Dirección de Envío"
          />
        </div>
      ))}
    </div>
  );
}
