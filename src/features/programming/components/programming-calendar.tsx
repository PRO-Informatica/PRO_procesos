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
import { programmingColorVariables } from "../status-colors";
import { getProgrammingDisplayStatus } from "../status-presentation";

const calendarByStatus = {
  DRAFT: "draft",
  PENDING_CONFIRMATION: "pending",
  CONFIRMED: "confirmed",
  IN_EXECUTION: "execution",
  DISPATCH_COMPLETED: "dispatchCompleted",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
} as const;

function toCalendarEvent(item: ProgrammingItem, timezone: string, residentView: boolean): CalendarEvent {
  const point = Temporal.Instant.from(item.scheduledAt).toZonedDateTimeISO(timezone);
  const compact = `${formatProgrammingTime(item.scheduledAt, timezone)} · ${formatProgrammingQuantity(item.requestedQuantity)} ${item.unitCode} · ${item.supplierName}`;
  return {
    id: item.id,
    start: point as unknown as CalendarEvent["start"],
    end: point as unknown as CalendarEvent["end"],
    title: `${formatProgrammingQuantity(item.requestedQuantity)} ${item.unitCode} · ${item.supplierName}`,
    description: formatProgrammingStatus(item.effectiveStatus, residentView),
    calendarId: calendarByStatus[getProgrammingDisplayStatus(item.effectiveStatus, residentView)],
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
  residentView = false,
}: {
  items: ProgrammingItem[];
  timezone: string;
  onRangeChange: (range: ProgrammingRange) => void;
  onSelect: (id: string) => void;
  onCreateAt?: (scheduledAt: string) => void;
  residentView?: boolean;
}) {
  const { resolvedTheme } = useTheme();
  const config = useMemo<CalendarConfig>(
    () => {
      const weekAgenda = createViewWeekAgenda();
      weekAgenda.label = "Week";
      return {
      views: [
        createViewMonthGrid(),
        createViewMonthAgenda(),
        createViewWeek(),
        createViewDay(),
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
          lightColors: programmingColorVariables("CONFIRMED"),
          darkColors: programmingColorVariables("CONFIRMED"),
        },
        execution: {
          colorName: "execution",
          lightColors: programmingColorVariables("IN_EXECUTION"),
          darkColors: programmingColorVariables("IN_EXECUTION"),
        },
        dispatchCompleted: {
          colorName: "dispatchCompleted",
          lightColors: programmingColorVariables("DISPATCH_COMPLETED", residentView),
          darkColors: programmingColorVariables("DISPATCH_COMPLETED", residentView),
        },
        completed: {
          colorName: "completed",
          lightColors: programmingColorVariables("COMPLETED"),
          darkColors: programmingColorVariables("COMPLETED"),
        },
        cancelled: {
          colorName: "cancelled",
          lightColors: programmingColorVariables("CANCELLED"),
          darkColors: programmingColorVariables("CANCELLED"),
        },
        expired: {
          colorName: "expired",
          lightColors: programmingColorVariables("EXPIRED"),
          darkColors: programmingColorVariables("EXPIRED"),
        },
      },
      callbacks: {
        onRender(app) {
          // Schedule-X only calls onRangeUpdate after a navigation/change.
          // Load the actual visible range on first render as well.
          const range = app.calendarState.range.value;
          if (range) onRangeChange({
            start: range.start.toInstant().toString(),
            end: range.end.toInstant().toString(),
          });
        },
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
      events: items.map((item) => toCalendarEvent(item, timezone, residentView)),
      };
    },
    [items, onCreateAt, onRangeChange, onSelect, residentView, timezone],
  );
  const calendarApp = useNextCalendarApp(config);

  useEffect(() => {
    calendarApp?.events.set(items.map((item) => toCalendarEvent(item, timezone, residentView)));
  }, [calendarApp, items, residentView, timezone]);

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
