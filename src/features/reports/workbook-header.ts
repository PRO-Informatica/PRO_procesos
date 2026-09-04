import type { Workbook, Worksheet } from "exceljs";

export const REPORT_TABLE_HEADER_ROW = 6;

const COLORS = {
  ink: "FF17191F",
  muted: "FF667085",
  border: "FFE4E7EC",
  white: "FFFFFFFF",
  red: "FFED1B2F",
} as const;

type ReportColumn = {
  header: string;
  key: string;
  width: number;
};

export type ReportWorkbookHeader = {
  projectTitle: string;
  billingLegalName: string;
  billingTaxId: string;
  period: string;
};

export function addReportLogo(workbook: Workbook, logoBase64: string) {
  return workbook.addImage({
    base64: `data:image/png;base64,${logoBase64}`,
    extension: "png",
  });
}

export function setupReportSheet(
  sheet: Worksheet,
  columns: ReportColumn[],
  header: ReportWorkbookHeader,
  logoId: number,
) {
  sheet.columns = columns.map(({ key, width }) => ({ key, width }));
  sheet.views = [
    { state: "frozen", ySplit: REPORT_TABLE_HEADER_ROW, showGridLines: false },
  ];

  const lastColumn = sheet.getColumn(columns.length).letter;
  sheet.mergeCells("A1:B4");
  sheet.mergeCells(`C1:${lastColumn}1`);
  sheet.mergeCells(`C2:${lastColumn}2`);
  sheet.mergeCells(`C3:${lastColumn}3`);
  sheet.mergeCells(`C4:${lastColumn}4`);

  const logoCell = sheet.getCell("A1");
  logoCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.ink },
  };
  logoCell.border = {
    right: { style: "medium", color: { argb: COLORS.red } },
  };
  sheet.addImage(logoId, {
    tl: { col: 0.45, row: 0.55 },
    ext: { width: 132, height: 66 },
    editAs: "oneCell",
  });

  sheet.getRow(1).height = 29;
  sheet.getRow(2).height = 23;
  sheet.getRow(3).height = 23;
  sheet.getRow(4).height = 22;
  sheet.getRow(5).height = 9;

  const titleCell = sheet.getCell("C1");
  titleCell.value = header.projectTitle;
  titleCell.font = { bold: true, size: 18, color: { argb: COLORS.ink } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  const metadata = [
    ["C2", `Razón social de facturación: ${header.billingLegalName}`],
    ["C3", `NIT receptor: ${header.billingTaxId}`],
    ["C4", `Período: ${header.period}`],
  ] as const;
  for (const [cellAddress, value] of metadata) {
    const cell = sheet.getCell(cellAddress);
    cell.value = value;
    cell.font = {
      size: cellAddress === "C4" ? 9 : 10,
      color: { argb: cellAddress === "C4" ? COLORS.muted : COLORS.ink },
      bold: cellAddress !== "C4",
    };
    cell.alignment = { vertical: "middle", horizontal: "left" };
  }

  const tableHeader = sheet.getRow(REPORT_TABLE_HEADER_ROW);
  tableHeader.values = columns.map(({ header: columnHeader }) => columnHeader);
  tableHeader.height = 34;
  tableHeader.font = { bold: true, size: 10, color: { argb: COLORS.white } };
  tableHeader.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLORS.red },
  };
  tableHeader.alignment = {
    vertical: "middle",
    horizontal: "center",
    wrapText: true,
  };
  tableHeader.eachCell((cell) => {
    cell.border = {
      right: { style: "thin", color: { argb: "FFFF8791" } },
    };
  });

  sheet.autoFilter = {
    from: { row: REPORT_TABLE_HEADER_ROW, column: 1 },
    to: { row: REPORT_TABLE_HEADER_ROW, column: columns.length },
  };
}
