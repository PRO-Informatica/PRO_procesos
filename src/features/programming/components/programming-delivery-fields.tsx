"use client";

import { useState } from "react";

import {
  DELIVERY_MODES,
  DELIVERY_MODE_LABELS,
  requiresServiceInvoice,
  type DeliveryMode,
} from "../invoice-policy";

export function ProgrammingDeliveryFields({
  initialModes = [],
  disabled = false,
}: {
  initialModes?: DeliveryMode[];
  disabled?: boolean;
}) {
  const [modes, setModes] = useState(initialModes);
  return (
    <fieldset className="space-y-3 sm:col-span-2" disabled={disabled}>
      <legend className="form-label">Modalidad de entrega</legend>
      <div className="grid gap-2 min-[460px]:grid-cols-2">
        {DELIVERY_MODES.map((mode) => (
          <label key={mode} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <input
              type="checkbox"
              name="deliveryModes"
              value={mode}
              checked={modes.includes(mode)}
              onChange={(event) => setModes((current) => event.target.checked
                ? DELIVERY_MODES.filter((entry) => current.includes(entry) || entry === mode)
                : current.filter((entry) => entry !== mode))}
              className="accent-brand"
            />
            {DELIVERY_MODE_LABELS[mode]}
          </label>
        ))}
      </div>
      <p className="text-xs leading-5 text-foreground-muted" aria-live="polite">
        {requiresServiceInvoice(modes)
          ? "El cierre requiere producto conciliado y factura de servicio. Sin modalidad se conserva este requisito."
          : "El cierre requiere producto conciliado. La factura de servicio es opcional y puede cargarse mientras el lote esté abierto."}
      </p>
    </fieldset>
  );
}
