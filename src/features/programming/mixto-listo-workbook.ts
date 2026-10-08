import "server-only";

import {
  extractMixtoProgrammingWorkbookBuffer,
  isApprovedProgrammingDayAllowed,
  MIXTO_APPROVED_WORKBOOK_ERROR,
  MIXTO_WORKBOOK_ERROR,
  type MixtoWorkbookProject,
} from "./mixto-listo-workbook-parser";

export {
  isApprovedProgrammingDayAllowed,
  MIXTO_APPROVED_WORKBOOK_ERROR,
  MIXTO_WORKBOOK_ERROR,
};

const MAX_WORKBOOK_BYTES = 10 * 1024 * 1024;

export async function extractMixtoProgrammingWorkbook(
  file: File,
  project: MixtoWorkbookProject,
) {
  if (
    file.size <= 0 ||
    file.size > MAX_WORKBOOK_BYTES ||
    !file.name.toLowerCase().endsWith(".xlsx")
  ) throw new Error(MIXTO_WORKBOOK_ERROR);

  return extractMixtoProgrammingWorkbookBuffer(
    Buffer.from(await file.arrayBuffer()),
    project,
  );
}
