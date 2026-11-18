"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { paginationHref, paginationModel, parsePaginationTarget } from "./pagination-model";
import styles from "./pagination.module.css";

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  ariaLabel?: string;
  itemLabel?: string;
  className?: string;
  disabled?: boolean;
} & (
  | { onPageChange: (page: number) => void; href?: never; pageParam?: never }
  | { href: string; pageParam?: string; onPageChange?: never }
);

export function Pagination({ page, pageSize, total, ariaLabel = "Paginación de resultados", itemLabel = "registros", className = "", disabled = false, ...navigation }: PaginationProps) {
  const router = useRouter();
  const { currentPage, pageCount, firstItem, lastItem, pages } = paginationModel(page, pageSize, total);
  function goToPage(target: number) {
    if (disabled || target === currentPage || target < 1 || target > pageCount) return;
    if (navigation.onPageChange) navigation.onPageChange(target);
    else router.push(paginationHref(navigation.href!, target, navigation.pageParam), { scroll: false });
  }
  function control(target: number, content: ReactNode, label: string, arrow = false) {
    const active = !arrow && target === currentPage;
    const unavailable = disabled || target < 1 || target > pageCount;
    const controlClass = `${styles.control} ${arrow ? styles.arrow : ""} ${active ? styles.active : ""}`;
    const props = { className: controlClass, "aria-label": label, "aria-current": active ? "page" as const : undefined };
    if (navigation.href !== undefined && !unavailable) {
      return <Link key={label} {...props} href={paginationHref(navigation.href, target, navigation.pageParam)} scroll={false}>{content}</Link>;
    }
    return <button key={label} {...props} type="button" disabled={unavailable} onClick={() => goToPage(target)}>{content}</button>;
  }
  return (
    <nav className={`${styles.root} ${className}`} aria-label={ariaLabel}>
      <div className={styles.layout}>
        <p role="status" className={styles.summary}>Mostrando <strong>{firstItem}–{lastItem}</strong> de <strong>{total}</strong> {itemLabel}</p>
        <div className={styles.controls}>
          {control(currentPage - 1, <ChevronLeft aria-hidden="true" />, "Ver página anterior", true)}
          {pages.map((target) => control(target, target, `Ir a la página ${target}`))}
          {control(currentPage + 1, <ChevronRight aria-hidden="true" />, "Ver página siguiente", true)}
        </div>
        <PageJump key={currentPage} pageCount={pageCount} disabled={disabled || pageCount === 1} onGo={goToPage} />
      </div>
    </nav>
  );
}

function PageJump({ pageCount, disabled, onGo }: { pageCount: number; disabled: boolean; onGo: (page: number) => void }) {
  const [{ value, error }, setInput] = useState({ value: "", error: "" });
  return (
    <label className={styles.jump}>
      <span>Ir a:</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(event) => setInput({ value: event.target.value, error: "" })}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const target = parsePaginationTarget(value, pageCount);
          if (target === null) {
            setInput({ value, error: `Ingresa una página entre 1 y ${pageCount}.` });
          } else onGo(target);
        }}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-label={`Ir a una página entre 1 y ${pageCount}`}
        placeholder={`Ej. ${Math.min(10, pageCount)}`}
        title={`Escribe una página de 1 a ${pageCount} y presiona Enter`}
      />
      {error && <span role="alert" className={styles.validation}>{error}</span>}
    </label>
  );
}
