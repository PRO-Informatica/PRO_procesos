"use client";

import { Check, LoaderCircle, Search } from "lucide-react";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { searchDispatchCatalogAction } from "../actions";
import { formatDispatchMoney } from "../formatters";
import type { DispatchCatalogOption, DispatchCatalogType } from "../types";

type Filter = DispatchCatalogType | "ALL";
const EMPTY_ITEMS: DispatchCatalogOption[] = [];

export function DispatchCatalogCombobox({
  id, projectId, value, selectedId, productUnitCode, disabled = false, onSelect,
}: {
  id: string;
  projectId: string;
  value: string;
  selectedId: string;
  productUnitCode?: string;
  disabled?: boolean;
  onSelect: (item: DispatchCatalogOption) => void;
}) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ key: string; items: DispatchCatalogOption[]; error?: string } | null>(null);
  const search = query.trim();
  const key = `${projectId}:${filter}:${search}`;
  const current = result?.key === key ? result : null;
  const items = current?.items ?? EMPTY_ITEMS;
  const loading = Boolean(search) && (!current || pending);

  useEffect(() => {
    if (!open || !search) return;
    let active = true;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const response = await searchDispatchCatalogAction(projectId, filter, search);
          if (active) setResult(response.status === "success"
            ? { key, items: response.items }
            : { key, items: [], error: response.message });
        } catch {
          if (active) setResult({ key, items: [], error: "No se pudo consultar el catálogo. Vuelve a escribir para intentarlo." });
        }
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, search, filter, projectId, key]);

  useEffect(() => {
    const list = listRef.current;
    const option = list?.children.item(activeIndex) as HTMLElement | undefined;
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  }, [activeIndex, items, open]);

  const select = (item: DispatchCatalogOption) => {
    onSelect(item);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  return (
    <div className="min-w-0" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault(); event.stopPropagation(); setOpen(false);
      }
    }}>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 size-4 text-foreground-muted" />
        <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && !loading && items[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off" maxLength={120} disabled={disabled}
          value={open ? query : value || query}
          placeholder="Escribe código, referencia o servicio"
          onFocus={() => { setOpen(true); setActiveIndex(0); }}
          onClick={() => { if (!open) { setOpen(true); setQuery(""); setActiveIndex(0); } }}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault(); setOpen(true);
              setActiveIndex((index) => items.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length : 0);
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (open && !loading && items[activeIndex]) select(items[activeIndex]);
              else setOpen(true);
            }
          }}
          className="form-input dispatch-catalog-input min-w-0 disabled:bg-muted" />
        {selectedId && !open && <Check aria-hidden="true" className="pointer-events-none absolute right-3 top-3.5 size-4 text-emerald-600" />}
      </div>
      {open && !disabled && (
        <div className="mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <div className="flex flex-wrap gap-1 border-b border-border p-2" aria-label="Buscar en">
            {([['ALL', 'Todos'], ['PRODUCT', 'Productos'], ['SERVICE', 'Servicios']] as const).map(([type, label]) => (
              <button key={type} type="button" aria-pressed={filter === type}
                onClick={() => { setFilter(type); setActiveIndex(0); }}
                className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${filter === type ? "bg-brand-soft text-brand-strong" : "text-foreground-muted hover:bg-muted"}`}>{label}</button>
            ))}
          </div>
          {!search ? <p role="status" className="p-3 text-sm text-foreground-muted">Escribe para buscar productos y servicios de este proyecto.</p>
            : loading ? <p role="status" className="flex items-center gap-2 p-3 text-sm text-foreground-muted"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Buscando…</p>
            : current?.error ? <p role="alert" className="p-3 text-sm text-destructive">{current.error}</p>
            : items.length === 0 ? <p role="status" className="p-3 text-sm text-foreground-muted">Sin coincidencias. Prueba otro código o descripción.</p> : null}
          <div id={listId} ref={listRef} role="listbox" aria-label="Coincidencias del catálogo" aria-busy={loading}
            className="relative max-h-[min(20rem,40dvh)] overflow-y-auto overscroll-contain divide-y divide-border">
            {!loading && items.map((item, index) => (
              <button key={`${item.type}:${item.id}`} id={`${listId}-${index}`} type="button" role="option"
                aria-selected={index === activeIndex} tabIndex={-1}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => select(item)} onPointerMove={() => setActiveIndex(index)}
                className={`block min-h-12 w-full px-3 py-3 text-left text-sm ${index === activeIndex ? "bg-brand-soft/50" : "hover:bg-muted"}`}>
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="break-all font-semibold">{item.code} <span className="font-normal text-foreground-muted">· {item.type === "PRODUCT" ? "Producto" : "Servicio"}</span></span>
                  <span className="whitespace-nowrap font-semibold">{formatDispatchMoney(item.price, item.currency)}</span>
                </span>
                <span className="mt-1 block break-words [overflow-wrap:anywhere]">{(item.type === "PRODUCT" ? item.reference : item.description) || "Sin descripción"}</span>
                <span className="mt-1 block text-xs text-foreground-muted">UM: {(item.type === "PRODUCT" ? productUnitCode : item.unitCode) || "Sin UM"}</span>
                {item.type === "SERVICE" && item.observations && <span className="mt-1 block break-words text-xs text-foreground-muted [overflow-wrap:anywhere]">{item.observations}</span>}
              </button>
            ))}
          </div>
          {!loading && items.length > 0 && <p role="status" className="border-t border-border px-3 py-2 text-xs text-foreground-muted">{items.length} coincidencia(s). Usa ↑ ↓ y Enter o toca una opción.</p>}
        </div>
      )}
    </div>
  );
}
