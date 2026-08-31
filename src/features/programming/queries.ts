import "server-only";

import { createClient } from "@/lib/supabase/server";

import type {
  ProgrammingFilters,
  ProgrammingDetail,
  ProgrammingDetailPageData,
  ProgrammingItem,
  ProgrammingPageData,
  ProgrammingRange,
  ProgrammingStatus,
  ProgrammingSupplier,
  ProgrammingUnit,
} from "./types";

const DEFAULT_TIMEZONE = "America/Guatemala";

type ProgrammingRow = {
  id: string;
  project_id: string;
  supplier_id: string;
  created_by: string;
  scheduled_at: string;
  requested_quantity: number | string;
  confirmed_quantity: number | string | null;
  unit_code: string;
  placement_group: string | null;
  requires_pumping: boolean;
  estimated_work_item_id: string | null;
  status: ProgrammingStatus;
  notes: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
};

type DispatchRow = {
  id: string;
  programming_id: string;
  status: string;
  result: string | null;
  created_at: string;
};

type DispatchGuideRow = {
  dispatch_id: string;
  guide_number: string;
  guide_date: string;
  quantity: number | string;
  unit_code: string;
};

type ProgrammingLineRow = {
  id: string;
  programming_id: string;
  quantity: number | string;
  unit_code: string;
  position: number;
};

function numeric(value: number | string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateParts(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function zonedMidnightIso(value: string, timezone: string) {
  const [year, month, day] = value.split("-").map(Number);
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let guess = desired;

  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone: timezone,
    }).formatToParts(new Date(guess));
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    const represented = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    guess += desired - represented;
  }

  return new Date(guess).toISOString();
}

export function getInitialProgrammingRange(
  timezone = DEFAULT_TIMEZONE,
): ProgrammingRange {
  const now = dateParts(new Date(), timezone);
  const start = dateKey(now.year, now.month, 1);
  const end = dateKey(now.year, now.month + 1, 8);
  return {
    start: zonedMidnightIso(start, timezone),
    end: zonedMidnightIso(end, timezone),
  };
}

function validateRange(range: ProgrammingRange) {
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (
    !Number.isFinite(start.valueOf()) ||
    !Number.isFinite(end.valueOf()) ||
    end <= start ||
    end.valueOf() - start.valueOf() > 370 * 24 * 60 * 60 * 1000
  ) {
    throw new Error("El rango solicitado para programación no es válido.");
  }
}

export async function getProgrammingItems(
  projectId: string,
  range: ProgrammingRange,
  filters: ProgrammingFilters = {},
): Promise<ProgrammingItem[]> {
  validateRange(range);
  const supabase = await createClient();
  let programmingQuery = supabase
    .from("programming")
    .select(
      "id, project_id, supplier_id, created_by, scheduled_at, requested_quantity, confirmed_quantity, unit_code, placement_group, requires_pumping, estimated_work_item_id, status, notes, confirmed_at, confirmed_by",
    )
    .eq("project_id", projectId)
    .gte("scheduled_at", range.start)
    .lt("scheduled_at", range.end)
    .order("scheduled_at")
    .limit(500);

  if (filters.supplierId) {
    programmingQuery = programmingQuery.eq("supplier_id", filters.supplierId);
  }
  if (filters.status) {
    programmingQuery = programmingQuery.eq("status", filters.status);
  }

  const { data, error } = await programmingQuery;
  if (error) {
    throw new Error(`No fue posible cargar las programaciones. ${error.message}`);
  }

  const rows = (data ?? []) as ProgrammingRow[];
  if (rows.length === 0) return [];

  const programmingIds = rows.map((row) => row.id);
  const supplierIds = [...new Set(rows.map((row) => row.supplier_id))];
  const workItemIds = [
    ...new Set(
      rows
        .map((row) => row.estimated_work_item_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const profileIds = [
    ...new Set(
      rows
        .flatMap((row) => [row.created_by, row.confirmed_by])
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [suppliersResult, workItemsResult, profilesResult, dispatchesResult, linesResult] =
    await Promise.all([
      supabase.from("suppliers").select("id, name").in("id", supplierIds),
      workItemIds.length
        ? supabase
            .from("project_work_items")
            .select("id, code, name")
            .eq("project_id", projectId)
            .in("id", workItemIds)
        : Promise.resolve({ data: [], error: null }),
      profileIds.length
        ? supabase.from("profiles").select("id, full_name").in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("dispatches")
        .select("id, programming_id, status, result, created_at")
        .eq("project_id", projectId)
        .in("programming_id", programmingIds)
        .order("created_at", { ascending: false }),
      supabase
        .from("programming_lines")
        .select("id, programming_id, quantity, unit_code, position")
        .in("programming_id", programmingIds)
        .order("position"),
    ]);

  const relatedError = [
    suppliersResult.error,
    workItemsResult.error,
    profilesResult.error,
    dispatchesResult.error,
    linesResult.error,
  ].find(Boolean);
  if (relatedError) {
    throw new Error(`No fue posible resolver los datos relacionados. ${relatedError.message}`);
  }

  const supplierNames = new Map(
    (suppliersResult.data ?? []).map((supplier) => [supplier.id, supplier.name]),
  );
  const workItemLabels = new Map(
    (workItemsResult.data ?? []).map((item) => [
      item.id,
      `${item.code} · ${item.name}`,
    ]),
  );
  const profileNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      profile.full_name || "Usuario no disponible",
    ]),
  );
  const dispatchesByProgramming = new Map<string, DispatchRow[]>();
  const dispatchRows = (dispatchesResult.data ?? []) as DispatchRow[];
  const dispatchIds = dispatchRows.map((dispatch) => dispatch.id);
  const guidesResult = dispatchIds.length
    ? await supabase
        .from("dispatch_guides")
        .select("dispatch_id, guide_number, guide_date, quantity, unit_code")
        .in("dispatch_id", dispatchIds)
    : { data: [], error: null };
  if (guidesResult.error) {
    throw new Error(`No fue posible resolver las guías relacionadas. ${guidesResult.error.message}`);
  }
  const guidesByDispatch = new Map(
    ((guidesResult.data ?? []) as DispatchGuideRow[]).map((guide) => [
      guide.dispatch_id,
      guide,
    ]),
  );
  for (const dispatch of dispatchRows) {
    const current = dispatchesByProgramming.get(dispatch.programming_id) ?? [];
    current.push(dispatch);
    dispatchesByProgramming.set(dispatch.programming_id, current);
  }
  const linesByProgramming = new Map<string, ProgrammingLineRow[]>();
  for (const line of (linesResult.data ?? []) as ProgrammingLineRow[]) {
    const current = linesByProgramming.get(line.programming_id) ?? [];
    current.push(line);
    linesByProgramming.set(line.programming_id, current);
  }

  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    supplierId: row.supplier_id,
    supplierName: supplierNames.get(row.supplier_id) ?? "Proveedor no disponible",
    scheduledAt: row.scheduled_at,
    requestedQuantity: numeric(row.requested_quantity) ?? 0,
    confirmedQuantity: numeric(row.confirmed_quantity),
    unitCode: row.unit_code,
    placementGroup: row.placement_group,
    requiresPumping: row.requires_pumping,
    estimatedWorkItemId: row.estimated_work_item_id,
    estimatedWorkItemLabel: row.estimated_work_item_id
      ? workItemLabels.get(row.estimated_work_item_id) ?? "Renglón no disponible"
      : null,
    status: row.status,
    notes: row.notes,
    createdByName: profileNames.get(row.created_by) ?? "Usuario no disponible",
    confirmedAt: row.confirmed_at,
    confirmedByName: row.confirmed_by
      ? profileNames.get(row.confirmed_by) ?? "Usuario no disponible"
      : null,
    lines: (linesByProgramming.get(row.id) ?? []).map((line) => ({
      id: line.id,
      quantity: numeric(line.quantity) ?? 0,
      unitCode: line.unit_code,
      position: line.position,
    })),
    dispatches: (dispatchesByProgramming.get(row.id) ?? []).map((dispatch) => ({
      ...(() => {
        const guide = guidesByDispatch.get(dispatch.id);
        return {
          guideNumber: guide?.guide_number ?? null,
          guideDate: guide?.guide_date ?? null,
          quantity: numeric(guide?.quantity ?? null),
          unitCode: guide?.unit_code ?? null,
        };
      })(),
      id: dispatch.id,
      status: dispatch.status,
      result: dispatch.result,
      createdAt: dispatch.created_at,
    })),
  }));
}

export async function getProgrammingCatalogs(projectId: string) {
  const supabase = await createClient();
  const [projectSuppliersResult, unitsResult] = await Promise.all([
    supabase
      .from("project_suppliers")
      .select("supplier_id, suppliers(id, code, name, active)")
      .eq("project_id", projectId)
      .eq("active", true),
    supabase
      .from("units_of_measure")
      .select("code, name")
      .eq("active", true)
      .order("code"),
  ]);

  const error = [
    projectSuppliersResult.error,
    unitsResult.error,
  ].find(Boolean);
  if (error) {
    throw new Error(`No fue posible cargar los catálogos de programación. ${error.message}`);
  }

  type SupplierRelation = {
    id: string;
    code: string;
    name: string;
    active: boolean;
  };
  const suppliers = (projectSuppliersResult.data ?? [])
    .flatMap((row) => {
      const relation = row.suppliers as SupplierRelation | SupplierRelation[] | null;
      const supplier = Array.isArray(relation) ? relation[0] : relation;
      return supplier?.active ? [supplier] : [];
    })
    .map((supplier) => ({
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name)) satisfies ProgrammingSupplier[];

  return {
    suppliers,
    units: (unitsResult.data ?? []) as ProgrammingUnit[],
  };
}

type ProgrammingDetailRow = ProgrammingRow & {
  version: number;
  created_at: string;
  updated_at: string;
};

type ProgrammingRevisionRow = {
  id: string;
  programming_id: string;
  revision_no: number;
  programming_version: number;
  scheduled_at: string;
  supplier_id: string;
  requested_quantity: number | string;
  confirmed_quantity: number | string | null;
  unit_code: string;
  status: ProgrammingStatus;
  notes: string | null;
  change_reason: string | null;
  action: string;
  created_by: string;
  created_at: string;
};

type ProgrammingRevisionLineRow = ProgrammingLineRow & {
  revision_id: string;
};

export async function getProgrammingDetailPageData(
  projectId: string,
  programmingId: string,
): Promise<ProgrammingDetailPageData | null> {
  const supabase = await createClient();
  const { data: programmingData, error: programmingError } = await supabase
    .from("programming")
    .select(
      "id, project_id, supplier_id, created_by, scheduled_at, requested_quantity, confirmed_quantity, unit_code, placement_group, requires_pumping, estimated_work_item_id, status, notes, confirmed_at, confirmed_by, version, created_at, updated_at",
    )
    .eq("id", programmingId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (programmingError) {
    throw new Error(`No fue posible cargar el detalle. ${programmingError.message}`);
  }
  if (!programmingData) return null;

  const row = programmingData as ProgrammingDetailRow;
  const [linesResult, revisionsResult, dispatchesResult, catalogs] = await Promise.all([
    supabase
      .from("programming_lines")
      .select("id, programming_id, quantity, unit_code, position")
      .eq("programming_id", programmingId)
      .order("position"),
    supabase
      .from("programming_revisions")
      .select(
        "id, programming_id, revision_no, programming_version, scheduled_at, supplier_id, requested_quantity, confirmed_quantity, unit_code, status, notes, change_reason, action, created_by, created_at",
      )
      .eq("programming_id", programmingId)
      .order("revision_no", { ascending: false }),
    supabase
      .from("dispatches")
      .select("id, programming_id, status, result, created_at")
      .eq("programming_id", programmingId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    getProgrammingCatalogs(projectId),
  ]);

  const firstError = [
    linesResult.error,
    revisionsResult.error,
    dispatchesResult.error,
  ].find(Boolean);
  if (firstError) {
    throw new Error(`No fue posible cargar las relaciones del detalle. ${firstError.message}`);
  }

  const revisions = (revisionsResult.data ?? []) as ProgrammingRevisionRow[];
  const revisionIds = revisions.map((revision) => revision.id);
  const dispatches = (dispatchesResult.data ?? []) as DispatchRow[];
  const dispatchIds = dispatches.map((dispatch) => dispatch.id);
  const actorIds = [
    row.created_by,
    row.confirmed_by,
    ...revisions.map((revision) => revision.created_by),
  ].filter((id): id is string => Boolean(id));
  const supplierIds = [
    row.supplier_id,
    ...revisions.map((revision) => revision.supplier_id),
  ];

  const [revisionLinesResult, guidesResult, profilesResult, suppliersResult] =
    await Promise.all([
      revisionIds.length
        ? supabase
            .from("programming_revision_lines")
            .select("id, programming_id, revision_id, quantity, unit_code, position")
            .in("revision_id", revisionIds)
            .order("position")
        : Promise.resolve({ data: [], error: null }),
      dispatchIds.length
        ? supabase
            .from("dispatch_guides")
            .select("dispatch_id, guide_number, guide_date, quantity, unit_code")
            .in("dispatch_id", dispatchIds)
        : Promise.resolve({ data: [], error: null }),
      actorIds.length
        ? supabase.from("profiles").select("id, full_name").in("id", [...new Set(actorIds)])
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("suppliers")
        .select("id, name")
        .in("id", [...new Set(supplierIds)]),
    ]);

  const nestedError = [
    revisionLinesResult.error,
    guidesResult.error,
    profilesResult.error,
    suppliersResult.error,
  ].find(Boolean);
  if (nestedError) {
    throw new Error(`No fue posible resolver el historial. ${nestedError.message}`);
  }

  const names = new Map(
    (profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name]),
  );
  const supplierNames = new Map(
    (suppliersResult.data ?? []).map((supplier) => [supplier.id, supplier.name]),
  );
  const revisionLinesByRevision = new Map<string, ProgrammingRevisionLineRow[]>();
  for (const line of (revisionLinesResult.data ?? []) as ProgrammingRevisionLineRow[]) {
    const current = revisionLinesByRevision.get(line.revision_id) ?? [];
    current.push(line);
    revisionLinesByRevision.set(line.revision_id, current);
  }
  const guideByDispatch = new Map(
    ((guidesResult.data ?? []) as DispatchGuideRow[]).map((guide) => [guide.dispatch_id, guide]),
  );

  const mappedDispatches = dispatches.map((dispatch) => {
    const guide = guideByDispatch.get(dispatch.id);
    return {
      id: dispatch.id,
      status: dispatch.status,
      result: dispatch.result,
      createdAt: dispatch.created_at,
      guideNumber: guide?.guide_number ?? null,
      guideDate: guide?.guide_date ?? null,
      quantity: numeric(guide?.quantity ?? null),
      unitCode: guide?.unit_code ?? null,
    };
  });
  const dispatchedQuantity = mappedDispatches.reduce(
    (total, dispatch) =>
      dispatch.result === "COMPLETE" || dispatch.result === "PARTIAL"
        ? total + (dispatch.quantity ?? 0)
        : total,
    0,
  );
  const targetQuantity = numeric(row.confirmed_quantity) ?? numeric(row.requested_quantity) ?? 0;

  const detail: ProgrammingDetail = {
    id: row.id,
    projectId: row.project_id,
    supplierId: row.supplier_id,
    supplierName: supplierNames.get(row.supplier_id) ?? "Proveedor no disponible",
    scheduledAt: row.scheduled_at,
    requestedQuantity: numeric(row.requested_quantity) ?? 0,
    confirmedQuantity: numeric(row.confirmed_quantity),
    unitCode: row.unit_code,
    placementGroup: row.placement_group,
    requiresPumping: row.requires_pumping,
    estimatedWorkItemId: row.estimated_work_item_id,
    estimatedWorkItemLabel: null,
    status: row.status,
    notes: row.notes,
    createdByName: names.get(row.created_by) || "Usuario no disponible",
    confirmedAt: row.confirmed_at,
    confirmedByName: row.confirmed_by
      ? names.get(row.confirmed_by) || "Usuario no disponible"
      : null,
    lines: ((linesResult.data ?? []) as ProgrammingLineRow[]).map((line) => ({
      id: line.id,
      quantity: numeric(line.quantity) ?? 0,
      unitCode: line.unit_code,
      position: line.position,
    })),
    dispatches: mappedDispatches,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dispatchedQuantity,
    remainingQuantity: Math.max(targetQuantity - dispatchedQuantity, 0),
    excessQuantity: Math.max(dispatchedQuantity - targetQuantity, 0),
    revisions: revisions.map((revision) => ({
      id: revision.id,
      revisionNo: revision.revision_no,
      version: revision.programming_version,
      action: revision.action,
      status: revision.status,
      supplierName: supplierNames.get(revision.supplier_id) ?? "Proveedor no disponible",
      scheduledAt: revision.scheduled_at,
      requestedQuantity: numeric(revision.requested_quantity) ?? 0,
      confirmedQuantity: numeric(revision.confirmed_quantity),
      unitCode: revision.unit_code,
      notes: revision.notes,
      changeReason: revision.change_reason,
      actorName: names.get(revision.created_by) || "Usuario no disponible",
      createdAt: revision.created_at,
      lines: (revisionLinesByRevision.get(revision.id) ?? []).map((line) => ({
        id: line.id,
        quantity: numeric(line.quantity) ?? 0,
        unitCode: line.unit_code,
        position: line.position,
      })),
    })),
  };

  return { detail, ...catalogs };
}

export async function getProgrammingPageData(
  projectId: string,
  timezone: string,
): Promise<ProgrammingPageData> {
  const range = getInitialProgrammingRange(timezone);
  const [items, catalogs] = await Promise.all([
    getProgrammingItems(projectId, range),
    getProgrammingCatalogs(projectId),
  ]);
  return { items, range, ...catalogs };
}
