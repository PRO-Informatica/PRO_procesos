"use client";

import { Archive, FileSpreadsheet } from "lucide-react";
import { useState } from "react";

import { LoadingButton } from "@/components/feedback/loading-button";
import { notify } from "@/lib/notify";

function responseFilename(response: Response, fallback: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  return disposition.match(/filename="?([^";]+)"?/iu)?.[1] ?? fallback;
}

export function ReportExportActions({ query }: { query: string }) {
  const [pending, setPending] = useState<"xlsx" | "zip" | null>(null);

  async function download(format: "xlsx" | "zip") {
    if (pending) return;
    setPending(format);
    try {
      const separator = query ? "&" : "";
      const response = await fetch(`/reports/export?${query}${separator}format=${format}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message ?? "No fue posible generar la exportación.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = responseFilename(response, format === "xlsx" ? "Reporte.xlsx" : "Reporte.zip");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      notify.success(format === "xlsx" ? "Excel descargado" : "ZIP descargado");
    } catch (error) {
      notify.error("Exportación no disponible", error instanceof Error ? error.message : "Intenta nuevamente.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid w-full grid-cols-1 gap-2 min-[390px]:grid-cols-2 lg:w-auto">
      <LoadingButton
        type="button"
        variant="secondary"
        loading={pending === "xlsx"}
        disabled={pending !== null}
        loadingLabel="Generando Excel…"
        onClick={() => download("xlsx")}
        className="w-full lg:min-w-[168px]"
      >
        <FileSpreadsheet aria-hidden="true" className="size-4" />
        Exportar Excel
      </LoadingButton>
      <LoadingButton
        type="button"
        loading={pending === "zip"}
        disabled={pending !== null}
        loadingLabel="Preparando ZIP…"
        onClick={() => download("zip")}
        className="w-full lg:min-w-[168px]"
      >
        <Archive aria-hidden="true" className="size-4" />
        Descargar ZIP
      </LoadingButton>
    </div>
  );
}
