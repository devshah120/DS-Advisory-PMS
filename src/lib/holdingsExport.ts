import ExcelJS from 'exceljs';

/**
 * One position as it appears in a client's holdings export. Mirrors the
 * ClientPositionRow the drill-down table renders, kept structural so the page
 * can hand its rows straight over without a mapping step.
 */
export interface HoldingsExportRow {
  srNo: number;
  symbol: string;
  name: string;
  quantity: number;
  averageCostBasis: number;
  costBasisTotal: number;
  lastPrice: number;
  currentValue: number;
  pl: number;
  plPercent: number;
  allocPercent: number;
}

const FONT_NAME = 'Perpetua';
const HEADING_SIZE = 13;
const BODY_SIZE = 11;

/** Whole numbers with thousands separators — the firm reports no cents. */
const WHOLE_NUMBER = '#,##0';
/** Percent columns carry a literal % so the sheet reads as the reference does. */
const WHOLE_PERCENT = '0%';

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFFFF' },
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

/** Gain and loss tints for the %PL column, matching the reference workbook. */
const GAIN_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFC6EFCE' },
};
const LOSS_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFC7CE' },
};

interface ColumnSpec {
  header: string;
  width: number;
  /** Undefined for the text columns, which stay left-aligned and unformatted. */
  numFmt?: string;
  align: 'left' | 'center' | 'right';
  value: (row: HoldingsExportRow) => string | number;
}

const COLUMNS: ColumnSpec[] = [
  { header: 'Sr No', width: 7, align: 'center', value: (r) => r.srNo },
  { header: 'Symbol', width: 11, align: 'left', value: (r) => r.symbol },
  { header: 'Name', width: 34, align: 'left', value: (r) => r.name },
  { header: 'Quantity', width: 11, align: 'right', numFmt: WHOLE_NUMBER, value: (r) => r.quantity },
  {
    header: 'Average Cost Basis',
    width: 18,
    align: 'right',
    numFmt: WHOLE_NUMBER,
    value: (r) => r.averageCostBasis,
  },
  {
    header: 'Cost Basis Total',
    width: 16,
    align: 'right',
    numFmt: WHOLE_NUMBER,
    value: (r) => r.costBasisTotal,
  },
  { header: 'Last Price', width: 12, align: 'right', numFmt: WHOLE_NUMBER, value: (r) => r.lastPrice },
  {
    header: 'Current Value',
    width: 14,
    align: 'right',
    numFmt: WHOLE_NUMBER,
    value: (r) => r.currentValue,
  },
  { header: 'PL', width: 11, align: 'right', numFmt: WHOLE_NUMBER, value: (r) => r.pl },
  // Stored as a fraction so Excel's own % format renders it — a pre-divided
  // value keeps the cell numeric and still sortable in the delivered file.
  {
    header: '%PL',
    width: 9,
    align: 'right',
    numFmt: WHOLE_PERCENT,
    value: (r) => r.plPercent / 100,
  },
  {
    header: '%alloc',
    width: 9,
    align: 'right',
    numFmt: WHOLE_PERCENT,
    value: (r) => r.allocPercent / 100,
  },
];

const ALLOC_COLUMN = COLUMNS.length; // 1-based index of %alloc
const PL_PERCENT_COLUMN = COLUMNS.length - 1;

/**
 * A client's positions laid out as the firm's reference sheet: Perpetua
 * throughout, whole numbers, percent-formatted return and weight columns, and
 * a green gradient down the allocation column so the largest position reads
 * darkest. Rows are written in the order given — the caller sorts by current
 * value, which is the same ordering as allocation.
 */
export function buildClientHoldingsWorkbook(
  clientName: string,
  rows: HoldingsExportRow[]
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DS Advisory';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Holdings', { views: [{ showGridLines: false }] });
  sheet.columns = COLUMNS.map((c) => ({ width: c.width }));

  const headerRow = sheet.addRow(COLUMNS.map((c) => c.header));
  headerRow.height = 20;
  headerRow.eachCell((cell, col) => {
    cell.font = { name: FONT_NAME, size: HEADING_SIZE, bold: true };
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    cell.alignment = {
      horizontal: COLUMNS[col - 1].align === 'left' ? 'left' : 'center',
      vertical: 'middle',
    };
  });

  for (const row of rows) {
    const added = sheet.addRow(COLUMNS.map((c) => c.value(row)));
    added.eachCell((cell, col) => {
      const spec = COLUMNS[col - 1];
      cell.font = { name: FONT_NAME, size: BODY_SIZE };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: spec.align, vertical: 'middle' };
      if (spec.numFmt) cell.numFmt = spec.numFmt;
    });

    // %PL reads green on a gain and red on a loss, as in the reference sheet.
    const plCell = added.getCell(PL_PERCENT_COLUMN);
    plCell.fill = row.plPercent >= 0 ? GAIN_FILL : LOSS_FILL;
  }

  applyAllocationGradient(sheet, rows.length);
  addTotalRow(sheet, rows);

  return wb;
}

/**
 * Shades the %alloc column from a pale to a deep green. Written as explicit
 * per-cell fills rather than a conditional-formatting rule so the gradient
 * survives in viewers that don't evaluate colour scales (Google Sheets
 * imports, Numbers, most PDF converters).
 */
function applyAllocationGradient(sheet: ExcelJS.Worksheet, rowCount: number): void {
  if (rowCount === 0) return;

  const values: number[] = [];
  for (let i = 0; i < rowCount; i++) {
    const cell = sheet.getRow(i + 2).getCell(ALLOC_COLUMN);
    values.push(typeof cell.value === 'number' ? cell.value : 0);
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;

  values.forEach((value, i) => {
    // A single position (or an all-equal book) has no spread to shade across,
    // so it takes the full-strength green rather than dividing by zero.
    const t = span > 0 ? (value - min) / span : 1;
    sheet.getRow(i + 2).getCell(ALLOC_COLUMN).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: greenAt(t) },
    };
  });
}

/**
 * Interpolates between the lightest and darkest green of the scale. `t` runs
 * 0 (smallest weight) to 1 (largest).
 */
function greenAt(t: number): string {
  const light = { r: 0xe8, g: 0xf5, b: 0xe9 };
  const dark = { r: 0x4c, g: 0xaf, b: 0x50 };
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
  return `FF${hex(mix(light.r, dark.r))}${hex(mix(light.g, dark.g))}${hex(mix(light.b, dark.b))}`;
}

/** Bold TOTAL line summing the money columns, ruled off from the positions. */
function addTotalRow(sheet: ExcelJS.Worksheet, rows: HoldingsExportRow[]): void {
  const totals = rows.reduce(
    (acc, r) => ({
      costBasisTotal: acc.costBasisTotal + r.costBasisTotal,
      currentValue: acc.currentValue + r.currentValue,
      pl: acc.pl + r.pl,
    }),
    { costBasisTotal: 0, currentValue: 0, pl: 0 }
  );

  const cells: (string | number | null)[] = [
    null,
    null,
    'TOTAL',
    null,
    null,
    totals.costBasisTotal,
    null,
    totals.currentValue,
    totals.pl,
    // Book-level return, computed off the totals rather than averaging the
    // per-row percentages, which would weight a tiny position like a large one.
    totals.costBasisTotal ? totals.pl / totals.costBasisTotal : 0,
    rows.length ? 1 : 0,
  ];

  const row = sheet.addRow(cells);
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const spec = COLUMNS[col - 1];
    cell.font = { name: FONT_NAME, size: BODY_SIZE, bold: true };
    cell.alignment = { horizontal: spec.align, vertical: 'middle' };
    cell.border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF000000' } } };
    if (spec.numFmt && cell.value !== null) cell.numFmt = spec.numFmt;
  });
}

/** Builds the workbook and hands it to the browser as an .xlsx download. */
export async function downloadClientHoldingsWorkbook(
  clientName: string,
  rows: HoldingsExportRow[]
): Promise<void> {
  const wb = buildClientHoldingsWorkbook(clientName, rows);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${clientName.replace(/\s+/g, '_').toLowerCase()}-holdings.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
