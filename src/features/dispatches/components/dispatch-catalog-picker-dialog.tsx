"use client";

import { Boxes, LoaderCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";

import { searchDispatchCatalogAction } from "../actions";
import { formatDispatchMoney } from "../formatters";
import type { DispatchCatalogOption, DispatchCatalogType } from "../types";

export function DispatchCatalogPickerDialog({
  projectId,
  initialType,
  onSelect,
  onClose,
}: {
  projectId: string;
  initialType: DispatchCatalogType;
  onSelect: (item: DispatchCatalogOption) => void;
  onClose: () => void;
}) {
  const [catalogType, setCatalogType] = useState<DispatchCatalogType>(initialType);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DispatchCatalogOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const result = await searchDispatchCatalogAction(projectId, catalogType, query);
      if (!active) return;
      if (result.status === "error") {
        setItems([]);
        setError(result.message);
      } else {
        setItems(result.items);
      }
      setLoading(false);
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [catalogType, projectId, query]);

  return (
    <Dialog title="Seleccionar producto o servicio" description="Solo se muestran registros del catálogo del proyecto actual." icon={Boxes} onClose={onClose} size="lg">
      <div className="space-y-4 p-4 sm:p-6">
        <div className="grid grid-cols-2 rounded-xl bg-muted p-1" role="tablist" aria-label="Tipo de catálogo">
          {(["PRODUCT", "SERVICE"] as const).map((type) => (
            <button key={type} type="button" role="tab" aria-selected={catalogType === type} onClick={() => { setCatalogType(type); setQuery(""); }} className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition-colors ${catalogType === type ? "bg-surface text-brand-strong shadow-sm" : "text-foreground-muted hover:text-foreground"}`}>
              {type === "PRODUCT" ? "Productos" : "Servicios"}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-foreground-muted" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={catalogType === "PRODUCT" ? "Buscar por código o referencia" : "Buscar por código o descripción"} className="form-input pl-10" maxLength={120} autoFocus />
        </div>
        <div className="min-h-64 overflow-hidden rounded-xl border border-border">
          {loading ? (
            <div className="grid min-h-64 place-items-center text-sm text-foreground-muted"><span className="inline-flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" /> Cargando catálogo…</span></div>
          ) : error ? (
            <div className="p-5 text-sm text-destructive" role="alert">{error}</div>
          ) : items.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-5 text-center text-sm text-foreground-muted">No se encontraron registros en este catálogo.</div>
          ) : (
            <div className="max-h-[24rem] overflow-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-foreground-muted"><tr><th className="px-4 py-3">Código</th><th className="px-4 py-3">{catalogType === "PRODUCT" ? "Referencia" : "Descripción"}</th>{catalogType === "SERVICE" && <th className="px-4 py-3">UM</th>}<th className="px-4 py-3 text-right">Precio</th><th className="px-4 py-3 text-right">Acción</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {items.map((item) => <tr key={item.id} className="hover:bg-muted/35"><td className="px-4 py-3 font-mono text-xs font-semibold">{item.code}</td><td className="px-4 py-3 font-medium">{(catalogType === "PRODUCT" ? item.reference : item.description) || "Sin descripción"}</td>{catalogType === "SERVICE" && <td className="px-4 py-3">{item.unitCode || "Sin UM"}</td>}<td className="px-4 py-3 text-right font-semibold">{formatDispatchMoney(item.price, item.currency)}</td><td className="px-4 py-3 text-right"><button type="button" onClick={() => onSelect(item)} className="secondary-button min-h-9 px-3 text-xs">Seleccionar</button></td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="text-xs text-foreground-muted">Se muestran hasta 50 coincidencias. Ajusta la búsqueda para encontrar un registro específico.</p>
      </div>
      <DialogFooter><Button variant="secondary" onClick={onClose}>Cerrar</Button></DialogFooter>
    </Dialog>
  );
}
