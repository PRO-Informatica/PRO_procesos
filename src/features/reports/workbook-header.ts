import type { Worksheet } from "exceljs";

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

export function setupReportSheet(
  sheet: Worksheet,
  columns: ReportColumn[],
  header: ReportWorkbookHeader,
) {
  sheet.columns = columns.map(({ key, width }) => ({ key, width }));
  sheet.views = [
    { state: "frozen", ySplit: REPORT_TABLE_HEADER_ROW, showGridLines: false },
  ];

  const lastColumn = sheet.getColumn(columns.length).letter;
  sheet.mergeCells(`A1:${lastColumn}1`);
  sheet.mergeCells(`A2:${lastColumn}2`);
  sheet.mergeCells(`A3:${lastColumn}3`);
  sheet.mergeCells(`A4:${lastColumn}4`);

  sheet.getRow(1).height = 29;
  const billingLegalNameLines = Math.max(1, header.billingLegalName.split("\n").length);
  const billingTaxIdLines = Math.max(1, header.billingTaxId.split("\n").length);
  sheet.getRow(2).height = Math.max(23, 17 * billingLegalNameLines);
  sheet.getRow(3).height = Math.max(23, 17 * billingTaxIdLines);
  sheet.getRow(4).height = 22;
  sheet.getRow(5).height = 9;

  const titleCell = sheet.getCell("A1");
  titleCell.value = header.projectTitle;
  titleCell.font = { bold: true, size: 18, color: { argb: COLORS.ink } };
  titleCell.alignment = { vertical: "middle", horizontal: "left" };

  const metadata = [
    ["A2", `Razón social de facturación: ${header.billingLegalName}`],
    ["A3", `NIT receptor: ${header.billingTaxId}`],
    ["A4", `Período: ${header.period}`],
  ] as const;
  for (const [cellAddress, value] of metadata) {
    const cell = sheet.getCell(cellAddress);
    cell.value = value;
    cell.font = {
      size: cellAddress === "A4" ? 9 : 10,
      color: { argb: cellAddress === "A4" ? COLORS.muted : COLORS.ink },
      bold: cellAddress !== "A4",
    };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
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
