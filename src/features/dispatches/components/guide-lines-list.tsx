"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Measure three actual cards, including warnings and wrapped mobile fields.
// The list stays keyboard-scrollable without imposing a desktop card height.
export function GuideLinesList({ count, children }: { count: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useEffect(() => {
    const list = ref.current;
    if (!list || count <= 3) return;
    const cards = Array.from(list.children).slice(0, 3);
    const measure = () => setHeight(cards.reduce((sum, card) => sum + card.getBoundingClientRect().height, 0) + 24);
    const observer = new ResizeObserver(measure);
    cards.forEach((card) => observer.observe(card));
    observer.observe(list);
    measure();
    return () => observer.disconnect();
  }, [count, children]);
  return <>
    {count > 3 && <p className="text-xs text-foreground-muted">{count} líneas. Desplázate dentro de la lista para revisar todas.</p>}
    <div ref={ref} role={count > 3 ? "region" : undefined} aria-label={count > 3 ? "Lista de productos y servicios" : undefined} tabIndex={count > 3 ? 0 : undefined} style={count > 3 ? { maxHeight: height ? `min(${height}px, 65dvh)` : "65dvh" } : undefined} className={`min-w-0 space-y-3 rounded-xl ${count > 3 ? "overflow-y-auto overscroll-contain pr-2 pb-1 [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:outline-brand" : ""}`}>{children}</div>
  </>;
}
