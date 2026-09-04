"use client";

import type { CalendarConfig, CalendarEvent } from "@schedule-x/calendar";
import {
  createViewDay,
  createViewMonthAgenda,
  createViewMonthGrid,
  createViewWeek,
  createViewWeekAgenda,
} from "@schedule-x/calendar";
import { ScheduleXCalendar, useNextCalendarApp } from "@schedule-x/react";
import { useTheme } from "next-themes";
import { useEffect, useMemo } from "react";
import "temporal-polyfill/global";

import {
  formatProgrammingQuantity,
  formatProgrammingStatus,
  formatProgrammingTime,
} from "../formatters";
import type { ProgrammingItem, ProgrammingRange } from "../types";

const calendarByStatus = {
  DRAFT: "draft",
  PENDING_CONFIRMATION: "pending",
  CONFIRMED: "confirmed",
  IN_EXECUTION: "execution",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
} as const;

function toCalendarEvent(item: ProgrammingItem, timezone: string): CalendarEvent {
  const point = Temporal.Instant.from(item.scheduledAt).toZonedDateTimeISO(timezone);
  const compact = `${formatProgrammingTime(item.scheduledAt, timezone)} · ${formatProgrammingQuantity(item.requestedQuantity)} ${item.unitCode} · ${item.supplierName} · ${formatProgrammingStatus(item.effectiveStatus)}`;
  return {
    id: item.id,
    start: point as unknown as CalendarEvent["start"],
    end: point as unknown as CalendarEvent["end"],
    title: `${formatProgrammingQuantity(item.requestedQuantity)} ${item.unitCode} · ${item.supplierName}`,
    description: formatProgrammingStatus(item.effectiveStatus),
    calendarId: calendarByStatus[item.effectiveStatus],
    _customContent: {
      timeGrid: compact,
      dateGrid: compact,
      monthGrid: compact,
      monthAgenda: compact,
      weekAgenda: compact,
    },
    _options: { disableDND: true, disableResize: true },
  };
}

function isCalendarEventInteraction(event?: UIEvent) {
  const target = event?.target;
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        '[data-event-id], .sx__month-grid-day__events-more, .sx__event-modal',
      ),
    )
  );
}

export function ProgrammingCalendar({
  items,
  timezone,
  onRangeChange,
  onSelect,
  onCreateAt,
}: {
  items: ProgrammingItem[];
  timezone: string;
  onRangeChange: (range: ProgrammingRange) => void;
  onSelect: (id: string) => void;
  onCreateAt?: (scheduledAt: string) => void;
}) {
  const { resolvedTheme } = useTheme();
  const config = useMemo<CalendarConfig>(
    () => {
      const weekAgenda = createViewWeekAgenda();
      weekAgenda.label = "Week";
      return {
      views: [
        createViewMonthGrid(),
        createViewWeek(),
        createViewDay(),
        createViewMonthAgenda(),
        weekAgenda,
      ],
      defaultView: "month-grid",
      locale: "es-ES",
      timezone,
      selectedDate:
        Temporal.Now.zonedDateTimeISO(timezone).toPlainDate() as unknown as NonNullable<
          CalendarConfig["selectedDate"]
        >,
      isResponsive: true,
      dayBoundaries: { start: "05:00", end: "22:00" },
      weekOptions: { gridHeight: 920 },
      calendars: {
        draft: {
          colorName: "draft",
          lightColors: { main: "#667085", container: "#f2f4f7", onContainer: "#344054" },
          darkColors: { main: "#98a2b3", container: "#25272d", onContainer: "#e4e7ec" },
        },
        pending: {
          colorName: "pending",
          lightColors: { main: "#d97706", container: "#fef3c7", onContainer: "#92400e" },
          darkColors: { main: "#fbbf24", container: "#422006", onContainer: "#fde68a" },
        },
        confirmed: {
          colorName: "confirmed",
          lightColors: { main: "#2563eb", container: "#dbeafe", onContainer: "#1e40af" },
          darkColors: { main: "#60a5fa", container: "#172554", onContainer: "#bfdbfe" },
        },
        execution: {
          colorName: "execution",
          lightColors: { main: "#ed1c2e", container: "#fff0f1", onContainer: "#b42318" },
          darkColors: { main: "#ff6673", container: "#35171c", onContainer: "#fecdd3" },
        },
        completed: {
          colorName: "completed",
          lightColors: { main: "#16794d", container: "#ecfdf3", onContainer: "#166534" },
          darkColors: { main: "#6ce9a6", container: "#123326", onContainer: "#bbf7d0" },
        },
        cancelled: {
          colorName: "cancelled",
          lightColors: { main: "#b42318", container: "#fef3f2", onContainer: "#912018" },
          darkColors: { main: "#fda29b", container: "#3b1717", onContainer: "#fecaca" },
        },
        expired: {
          colorName: "expired",
          lightColors: { main: "#64748b", container: "#e2e8f0", onContainer: "#334155" },
          darkColors: { main: "#94a3b8", container: "#1e293b", onContainer: "#cbd5e1" },
        },
      },
      callbacks: {
        onEventClick(event) {
          onSelect(String(event.id));
        },
        onClickDate(date, event) {
          if (isCalendarEventInteraction(event)) return;
          onCreateAt?.(date.toString());
        },
        onClickDateTime(dateTime, event) {
          if (isCalendarEventInteraction(event)) return;
          onCreateAt?.(dateTime.toString().slice(0, 16));
        },
        onRangeUpdate(range) {
          onRangeChange({
            start: range.start.toInstant().toString(),
            end: range.end.toInstant().toString(),
          });
        },
      },
      events: [],
      };
    },
    [onCreateAt, onRangeChange, onSelect, timezone],
  );
  const calendarApp = useNextCalendarApp(config);

  useEffect(() => {
    calendarApp?.events.set(items.map((item) => toCalendarEvent(item, timezone)));
  }, [calendarApp, items, timezone]);

  useEffect(() => {
    calendarApp?.setTheme(resolvedTheme === "dark" ? "dark" : "light");
  }, [calendarApp, resolvedTheme]);

  return (
    <div
      className={`programming-calendar min-h-[500px] overflow-hidden rounded-xl border border-border bg-surface sm:min-h-[680px] ${
        onCreateAt ? "programming-calendar--create-enabled" : ""
      }`}
    >
      <ScheduleXCalendar calendarApp={calendarApp} />
    </div>
  );
}
