"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { dateLabel, dateValue, MONTH_NAMES, monthDays, monthStart, orderedRange, rangeDays, shiftDate, shiftMonth, type DateRange } from "./model";
import styles from "./date-range.module.css";

export function DateRangePicker({ from, to, label = "Rango de fechas" }: { from: string; to: string; label?: string }) {
  const id = useId();
  const [value, setValue] = useState<DateRange>({ from, to });
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from, to });
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthStart(from));
  const [focused, setFocused] = useState(from);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const shouldFocusDay = useRef(false);

  function close() { setOpen(false); trigger.current?.focus(); }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open && shouldFocusDay.current) {
      root.current?.querySelector<HTMLButtonElement>(`button[data-date="${focused}"]`)?.focus();
      shouldFocusDay.current = false;
    }
  }, [open, focused, month]);

  function select(date: string) {
    setFocused(date);
    setDraft((current) => current.to ? { from: date, to: "" } : orderedRange(current.from, date));
  }
  function navigateMonth(offset: number) {
    const next = shiftMonth(month, offset);
    setMonth(next);
    // Keep one calendar day reachable with Tab after using the month controls.
    if (focused < next || focused >= shiftMonth(next, 2)) setFocused(next);
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    let next: string | undefined;
    if (event.key === "ArrowLeft") next = shiftDate(date, -1);
    if (event.key === "ArrowRight") next = shiftDate(date, 1);
    if (event.key === "ArrowUp") next = shiftDate(date, -7);
    if (event.key === "ArrowDown") next = shiftDate(date, 7);
    if (event.key === "Home") next = shiftDate(date, -(dateValue(date).getUTCDay() + 6) % 7);
    if (event.key === "End") next = shiftDate(date, 6 - (dateValue(date).getUTCDay() + 6) % 7);
    if (event.key === "PageUp" || event.key === "PageDown") next = shiftMonth(date, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1));
    if (!next || next < "1900-01-01" || next > "9998-12-31") return;
    event.preventDefault();
    shouldFocusDay.current = true;
    setFocused(next);
    if (next < month || next >= shiftMonth(month, 2)) setMonth(monthStart(next));
  }

  return <div className={styles.root} ref={root} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <span id={`${id}-label`} className={styles.label}>{label}</span>
    <input type="hidden" name="from" value={value.from} />
    <input type="hidden" name="to" value={value.to} />
    <button type="button" ref={trigger} className={styles.trigger} aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-calendar`} onClick={() => {
      if (open) { close(); return; }
      setDraft(value); setMonth(monthStart(value.from)); setFocused(value.from); shouldFocusDay.current = true; setOpen(true);
    }}><span id={`${id}-value`}>{dateLabel(value.from)} — {dateLabel(value.to)}</span><CalendarDays aria-hidden="true" size={18} /></button>
    {open && <div id={`${id}-calendar`} className={styles.popup} role="dialog" aria-labelledby={`${id}-label`}>
      <div className={styles.navigation}>
        <button type="button" aria-label="Mes anterior" disabled={month <= "1900-01-01"} onClick={() => navigateMonth(-1)}><ChevronLeft size={18} /></button>
        <span>Selecciona la fecha inicial y final</span>
        <button type="button" aria-label="Mes siguiente" disabled={month >= "9998-11-01"} onClick={() => navigateMonth(1)}><ChevronRight size={18} /></button>
      </div>
      <div className={styles.months}>
        {[month, shiftMonth(month, 1)].map((start) => {
          const date = dateValue(start), title = `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`, days = monthDays(start);
          return <div key={start} className={styles.month}>
            <h3>{title}</h3>
            <div className={styles.weekdays} aria-hidden="true">{["L", "M", "X", "J", "V", "S", "D"].map((day, i) => <span key={i}>{day}</span>)}</div>
            <div className={styles.days} role="group" aria-label={title}>
              {Array.from({ length: days.offset }, (_, i) => <span key={`blank-${i}`} />)}
              {days.dates.map((day) => {
                const endpoint = day === draft.from || day === draft.to;
                const selected = Boolean(draft.to && day >= draft.from && day <= draft.to);
                return <button type="button" key={day} data-date={day} data-endpoint={endpoint || undefined} data-range={selected || undefined} data-start={day === draft.from || undefined} data-end={day === draft.to || undefined} tabIndex={day === focused ? 0 : -1} aria-label={dateLabel(day)} aria-pressed={endpoint || selected} onFocus={() => setFocused(day)} onKeyDown={(event) => keyboard(event, day)} onClick={() => select(day)}><span>{Number(day.slice(-2))}</span></button>;
              })}
            </div>
          </div>;
        })}
      </div>
      <div className={styles.footer}>
        <span role="status" aria-live="polite">{draft.to ? `${rangeDays(draft.from, draft.to)} día(s)` : "Selecciona la fecha final"}</span>
        <button type="button" className="secondary-button" onClick={close}>Cancelar</button>
        <button type="button" className="primary-button" disabled={!draft.to} onClick={() => { setValue(draft); close(); }}>Listo</button>
      </div>
    </div>}
  </div>;
}
