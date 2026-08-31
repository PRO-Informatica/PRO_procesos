"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import type { ProgrammingUnit } from "../types";

type EditableLine = {
  quantity: string;
  unitCode: string;
};

export function ProgrammingLinesFields({
  units,
  initialLines,
  disabled = false,
}: {
  units: ProgrammingUnit[];
  initialLines?: EditableLine[];
  disabled?: boolean;
}) {
  const nextId = useRef(2);
  const [lines, setLines] = useState(() =>
    (initialLines?.length ? initialLines : [{ quantity: "", unitCode: "" }]).map(
      (line, index) => ({ ...line, id: `programming-line-${index + 1}` }),
    ),
  );

  return (
    <section className="sm:col-span-2" aria-labelledby="programming-lines-title">
      <div className="flex flex-col gap-3 min-[460px]:flex-row min-[460px]:items-end min-[460px]:justify-between">
        <div>
          <h3 id="programming-lines-title" className="text-sm font-semibold text-foreground">
            Productos
          </h3>
          <p className="mt-1 text-xs text-foreground-muted">
            Todas las líneas deben usar la misma unidad de medida.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const inheritedUnit = lines[0]?.unitCode ?? "";
            const id = `programming-line-${Date.now()}-${nextId.current++}`;
            setLines((current) => [
              ...current,
              { id, quantity: "", unitCode: inheritedUnit },
            ]);
          }}
          disabled={disabled}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          <Plus aria-hidden="true" className="size-4" />
          Agregar producto
        </button>
      </div>

      <div
        className={`subtle-scrollbar mt-3 space-y-3 ${
          lines.length > 3
            ? "max-h-[24rem] overflow-y-auto overscroll-contain pr-1 sm:max-h-[21rem]"
            : ""
        }`}
        aria-label="Líneas de productos"
      >
        {lines.map((line, index) => (
          <div
            key={line.id}
            className="grid min-w-0 grid-cols-[minmax(0,1fr)_6.5rem] gap-3 rounded-xl border border-border bg-muted/25 p-3 sm:grid-cols-[2rem_minmax(0,1fr)_9rem_2.75rem] sm:items-end sm:gap-2"
          >
            <span className="col-start-1 row-start-1 self-center text-xs font-semibold text-foreground sm:grid sm:size-8 sm:place-items-center sm:rounded-full sm:bg-surface sm:text-foreground-muted">
              <span className="sm:hidden">Producto </span>
              {index + 1}
            </span>
            <div className="col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1">
              <label htmlFor={`${line.id}-quantity`} className="form-label">
                Cantidad
              </label>
              <input
                id={`${line.id}-quantity`}
                name="lineQuantity"
                type="number"
                required
                min="0.001"
                step="0.001"
                inputMode="decimal"
                value={line.quantity}
                onChange={(event) => {
                  const quantity = event.target.value;
                  setLines((current) =>
                    current.map((candidate) =>
                      candidate.id === line.id
                        ? { ...candidate, quantity }
                        : candidate,
                    ),
                  );
                }}
                disabled={disabled}
                className="form-input"
              />
            </div>
            <div className="col-start-2 row-start-2 min-w-0 sm:col-start-3 sm:row-start-1">
              <label htmlFor={`${line.id}-unit`} className="form-label">
                UM
              </label>
              <select
                id={`${line.id}-unit`}
                name="lineUnitCode"
                required
                value={line.unitCode}
                onChange={(event) => {
                  const unitCode = event.target.value;
                  setLines((current) =>
                    current.map((candidate) =>
                      candidate.id === line.id
                        ? { ...candidate, unitCode }
                        : candidate,
                    ),
                  );
                }}
                disabled={disabled}
                className="form-input"
              >
                <option value="">—</option>
                {units.map((unit) => (
                  <option key={unit.code} value={unit.code}>
                    {unit.code}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() =>
                setLines((current) =>
                  current.filter((candidate) => candidate.id !== line.id),
                )
              }
              disabled={disabled || lines.length === 1}
              className="col-start-2 row-start-1 ml-auto grid size-9 place-items-center rounded-lg border border-border text-foreground-muted hover:border-destructive/30 hover:bg-destructive-soft hover:text-destructive disabled:cursor-not-allowed disabled:opacity-35 sm:col-start-4 sm:row-start-1 sm:size-11"
              aria-label={`Eliminar producto ${index + 1}`}
            >
              <Trash2 aria-hidden="true" className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
