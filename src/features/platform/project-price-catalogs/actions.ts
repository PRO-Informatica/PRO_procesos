"use server";

import { revalidatePath } from "next/cache";

import { isPlatformAdmin } from "@/features/platform/queries";
import { createClient } from "@/lib/supabase/server";

import { parseProjectPriceCatalog } from "./parser";
import type {
  PriceCatalogActionResult,
  PriceCatalogImportMode,
  PriceCatalogImportResult,
  PriceCatalogKind,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function authorizeAndValidateProject(companyId: string, projectId: string) {
  if (!UUID.test(companyId) || !UUID.test(projectId)) return null;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (!userId || !(await isPlatformAdmin(userId))) return null;

  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle<{ id: string }>();
  if (error || !data) return null;
  return supabase;
}

function readCatalogKind(formData: FormData): PriceCatalogKind | null {
  const value = textValue(formData, "catalogKind").toUpperCase();
  return value === "PRODUCT" || value === "SERVICE" ? value : null;
}

function readMode(formData: FormData): PriceCatalogImportMode | null {
  const value = textValue(formData, "mode").toUpperCase();
  return value === "REPLACE" || value === "UPDATE" ? value : null;
}

function readFile(formData: FormData) {
  const file = formData.get("file");
  return file instanceof File ? file : null;
}

function catalogPath(companyId: string, projectId: string) {
  return `/platform/companies/${companyId}/projects/${projectId}/catalogs`;
}

export async function previewProjectPriceCatalogAction(
  formData: FormData,
): Promise<PriceCatalogActionResult> {
  const companyId = textValue(formData, "companyId");
  const projectId = textValue(formData, "projectId");
  const catalogKind = readCatalogKind(formData);
  const file = readFile(formData);
  if (!catalogKind || !file) {
    return { status: "error", message: "Selecciona el catálogo y un archivo Excel válido." };
  }
  if (!(await authorizeAndValidateProject(companyId, projectId))) {
    return { status: "error", message: "No tienes autorización para administrar este catálogo." };
  }

  try {
    const preview = await parseProjectPriceCatalog(file, catalogKind);
    return { status: "success", ...preview };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "No fue posible validar el archivo.",
    };
  }
}

export async function importProjectPriceCatalogAction(
  formData: FormData,
): Promise<PriceCatalogImportResult> {
  const companyId = textValue(formData, "companyId");
  const projectId = textValue(formData, "projectId");
  const catalogKind = readCatalogKind(formData);
  const mode = readMode(formData);
  const file = readFile(formData);
  if (!catalogKind || !mode || !file) {
    return { status: "error", message: "La solicitud de importación no es válida." };
  }

  const supabase = await authorizeAndValidateProject(companyId, projectId);
  if (!supabase) {
    return { status: "error", message: "No tienes autorización para administrar este catálogo." };
  }

  try {
    // Reparse on the server during confirmation; never trust the client preview.
    const preview = await parseProjectPriceCatalog(file, catalogKind);
    if (preview.errorCount > 0) {
      return { status: "error", message: "Corrige todos los errores del Excel antes de importarlo." };
    }
    const rows = preview.rows.map((row) => ({
      code: row.code,
      ...(catalogKind === "PRODUCT" ? { reference: row.reference } : {}),
      price: row.price,
    }));
    const { data, error } = await supabase.rpc("platform_import_project_price_catalog", {
      p_company_id: companyId,
      p_project_id: projectId,
      p_catalog_type: catalogKind,
      p_mode: mode,
      p_file_name: preview.fileName,
      p_rows: rows,
    });
    if (error) throw error;

    const result = data as {
      inserted_count?: number;
      updated_count?: number;
      total_count?: number;
    } | null;
    const insertedCount = Number(result?.inserted_count ?? 0);
    const updatedCount = Number(result?.updated_count ?? 0);
    const totalCount = Number(result?.total_count ?? 0);
    revalidatePath(catalogPath(companyId, projectId));
    revalidatePath(`/platform/companies/${companyId}`);
    return {
      status: "success",
      message: mode === "REPLACE" ? "Catálogo reemplazado correctamente." : "Catálogo actualizado correctamente.",
      insertedCount,
      updatedCount,
      totalCount,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.toUpperCase() : "";
    if (message.includes("PERMISSION_DENIED")) {
      return { status: "error", message: "No tienes autorización para administrar este catálogo." };
    }
    if (message.includes("PROJECT_NOT_FOUND")) {
      return { status: "error", message: "El proyecto ya no existe o no pertenece a esta empresa." };
    }
    return { status: "error", message: "No fue posible importar el catálogo. No se guardó ningún cambio." };
  }
}
