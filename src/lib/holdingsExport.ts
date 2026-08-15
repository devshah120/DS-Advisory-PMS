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
  /** Drives the sector allocation block; already defaulted to 'Uncategorized'. */
  sector: string;
  quantity: number;
  averageCostBasis: number;
  costBasisTotal: number;
  lastPrice: number;
  currentValue: number;
  pl: number;
  plPercent: number;
  allocPercent: number;
  /**
   * How many of a household's accounts hold the name. Set only by the family
   * export, which adds an "Accounts" column for it; undefined on an individual
   * client's sheet, where every row would trivially read 1.
   */
  accounts?: number;
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

/**
 * Slice colours for the sector pie. Ordered so adjacent slices stay
 * distinguishable, and picked to remain separable in greyscale for the advisors
 * who print these sheets. Cash always takes CASH_SLICE_COLOR instead, wherever
 * it lands in the ordering.
 */
const SECTOR_COLORS = [
  '4C72B0', 'DD8452', '55A868', 'C44E52', '8172B3',
  '937860', 'DA8BC3', '8C8C8C', 'CCB974', '64B5CD',
];
const CASH_SLICE_COLOR = 'B0B0B0';

/** One sector's share of the portfolio, as rendered in the allocation block. */
interface SectorSlice {
  label: string;
  value: number;
  /** Fraction of the portfolio, 0–1. */
  weight: number;
  /** Slice fill, 6-digit hex without the alpha prefix. */
  color: string;
}

/**
 * Rolls positions up by sector, largest first, with cash as its own slice.
 * Cash belongs in the mix because the chart answers "where is this portfolio's
 * money", and an uninvested balance is a real answer to that.
 */
function buildSectorSlices(rows: HoldingsExportRow[], cashBalance: number): SectorSlice[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = row.sector || 'Uncategorized';
    totals.set(key, (totals.get(key) ?? 0) + row.currentValue);
  }

  const portfolioValue = rows.reduce((s, r) => s + r.currentValue, 0) + cashBalance;
  if (portfolioValue <= 0) return [];

  const slices = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], i) => ({
      label,
      value,
      weight: value / portfolioValue,
      color: SECTOR_COLORS[i % SECTOR_COLORS.length],
    }));

  if (cashBalance > 0) {
    slices.push({
      label: 'Cash',
      value: cashBalance,
      weight: cashBalance / portfolioValue,
      color: CASH_SLICE_COLOR,
    });
  }

  return slices;
}

interface ColumnSpec {
  header: string;
  width: number;
  /** Undefined for the text columns, which stay left-aligned and unformatted. */
  numFmt?: string;
  align: 'left' | 'center' | 'right';
  value: (row: HoldingsExportRow) => string | number;
}

const BASE_COLUMNS: ColumnSpec[] = [
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

/**
 * The "Accounts" column, inserted only into a family sheet. It sits right after
 * Name so the household's spread across mandates reads next to the name it
 * belongs to, before the figures start.
 */
const ACCOUNTS_COLUMN: ColumnSpec = {
  header: 'Accounts',
  width: 10,
  align: 'center',
  value: (r) => r.accounts ?? 1,
};

const NAME_COLUMN_INDEX = 3; // 1-based position of 'Name'

/**
 * The sheet's columns for a given variant. The individual-client layout is the
 * firm's reference sheet and stays exactly as it was; the family layout is that
 * same sheet with one column added, so both read as the same document.
 */
function columnsFor(variant: 'client' | 'family'): ColumnSpec[] {
  if (variant === 'client') return BASE_COLUMNS;
  return [
    ...BASE_COLUMNS.slice(0, NAME_COLUMN_INDEX),
    ACCOUNTS_COLUMN,
    ...BASE_COLUMNS.slice(NAME_COLUMN_INDEX),
  ];
}

/**
 * A client's positions laid out as the firm's reference sheet: Perpetua
 * throughout, whole numbers, percent-formatted return and weight columns, and
 * a green gradient down the allocation column so the largest position reads
 * darkest. Rows are written in the order given — the caller sorts by current
 * value, which is the same ordering as allocation.
 *
 * `cashBalance` is the client's idle cash. When present it is written as its
 * own line below the positions and folded into the TOTAL, so the sheet foots to
 * the actual portfolio value and the weights sum to 100%.
 */
export function buildClientHoldingsWorkbook(
  clientName: string,
  rows: HoldingsExportRow[],
  cashBalance = 0,
  variant: 'client' | 'family' = 'client'
): ExcelJS.Workbook {
  const columns = columnsFor(variant);
  const allocColumn = columns.length; // 1-based index of %alloc
  const plPercentColumn = columns.length - 1;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Giriraj Global Capital';
  wb.created = new Date();

  const sheet = wb.addWorksheet(variant === 'family' ? 'Family Holdings' : 'Holdings', {
    views: [{ showGridLines: false }],
  });
  sheet.columns = columns.map((c) => ({ width: c.width }));

  const headerRow = sheet.addRow(columns.map((c) => c.header));
  headerRow.height = 20;
  headerRow.eachCell((cell, col) => {
    cell.font = { name: FONT_NAME, size: HEADING_SIZE, bold: true };
    cell.fill = HEADER_FILL;
    cell.border = THIN_BORDER;
    cell.alignment = {
      horizontal: columns[col - 1].align === 'left' ? 'left' : 'center',
      vertical: 'middle',
    };
  });

  for (const row of rows) {
    const added = sheet.addRow(columns.map((c) => c.value(row)));
    added.eachCell((cell, col) => {
      const spec = columns[col - 1];
      cell.font = { name: FONT_NAME, size: BODY_SIZE };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: spec.align, vertical: 'middle' };
      if (spec.numFmt) cell.numFmt = spec.numFmt;
    });

    // %PL reads green on a gain and red on a loss, as in the reference sheet.
    const plCell = added.getCell(plPercentColumn);
    plCell.fill = row.plPercent >= 0 ? GAIN_FILL : LOSS_FILL;
  }

  applyAllocationGradient(sheet, rows.length, allocColumn);
  if (cashBalance > 0) addCashRow(sheet, rows, cashBalance, columns, allocColumn);
  addTotalRow(sheet, rows, cashBalance, columns);
  addSectorAllocationBlock(wb, sheet, buildSectorSlices(rows, cashBalance));

  return wb;
}

/**
 * Idle cash as a line of its own. It carries a current value and a weight but
 * no cost basis or P&L — cash isn't a position that can gain or lose, so those
 * columns stay blank rather than reading as a flat 0% return. Deliberately not
 * part of the gradient above, which ranks the invested names against each other.
 */
function addCashRow(
  sheet: ExcelJS.Worksheet,
  rows: HoldingsExportRow[],
  cashBalance: number,
  columns: ColumnSpec[],
  allocColumn: number
): void {
  const portfolioValue = rows.reduce((s, r) => s + r.currentValue, 0) + cashBalance;

  // Built by header rather than by position so the extra 'Accounts' column in
  // the family layout cannot shift the cash figures into the wrong cells.
  const byHeader: Record<string, string | number | null> = {
    'Sr No': rows.length + 1,
    Symbol: 'CASH',
    Name: 'Cash & Equivalents',
    'Current Value': cashBalance,
    '%alloc': portfolioValue ? cashBalance / portfolioValue : 0,
  };
  const cells = columns.map((c) => byHeader[c.header] ?? null);

  const row = sheet.addRow(cells);
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const spec = columns[col - 1];
    cell.font = { name: FONT_NAME, size: BODY_SIZE, italic: true };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: spec.align, vertical: 'middle' };
    if (spec.numFmt && cell.value !== null) cell.numFmt = spec.numFmt;
  });

  // A neutral fill keeps the cash weight legible without implying it belongs on
  // the green scale used to rank the invested positions.
  row.getCell(allocColumn).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF0F0F0' },
  };
}

/**
 * Shades the %alloc column from a pale to a deep green. Written as explicit
 * per-cell fills rather than a conditional-formatting rule so the gradient
 * survives in viewers that don't evaluate colour scales (Google Sheets
 * imports, Numbers, most PDF converters).
 */
function applyAllocationGradient(
  sheet: ExcelJS.Worksheet,
  rowCount: number,
  allocColumn: number
): void {
  if (rowCount === 0) return;

  const values: number[] = [];
  for (let i = 0; i < rowCount; i++) {
    const cell = sheet.getRow(i + 2).getCell(allocColumn);
    values.push(typeof cell.value === 'number' ? cell.value : 0);
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;

  values.forEach((value, i) => {
    // A single position (or an all-equal book) has no spread to shade across,
    // so it takes the full-strength green rather than dividing by zero.
    const t = span > 0 ? (value - min) / span : 1;
    sheet.getRow(i + 2).getCell(allocColumn).fill = {
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

/**
 * Bold TOTAL line summing the money columns, ruled off from the positions.
 * Current value includes cash so the sheet foots to the portfolio value the
 * client sees; cost basis and P&L stay invested-only, which keeps the return
 * percentage a statement about the portfolio's performance rather than one
 * diluted by an uninvested balance.
 */
function addTotalRow(
  sheet: ExcelJS.Worksheet,
  rows: HoldingsExportRow[],
  cashBalance = 0,
  columns: ColumnSpec[] = BASE_COLUMNS
): void {
  const totals = rows.reduce(
    (acc, r) => ({
      costBasisTotal: acc.costBasisTotal + r.costBasisTotal,
      currentValue: acc.currentValue + r.currentValue,
      pl: acc.pl + r.pl,
    }),
    { costBasisTotal: 0, currentValue: 0, pl: 0 }
  );

  // Keyed by header for the same reason as the cash row — the family layout's
  // extra column must not push TOTAL's figures one cell to the right.
  const byHeader: Record<string, string | number | null> = {
    Name: 'TOTAL',
    'Cost Basis Total': totals.costBasisTotal,
    'Current Value': totals.currentValue + cashBalance,
    PL: totals.pl,
    // Book-level return, computed off the totals rather than averaging the
    // per-row percentages, which would weight a tiny position like a large one.
    '%PL': totals.costBasisTotal ? totals.pl / totals.costBasisTotal : 0,
    '%alloc': rows.length ? 1 : 0,
  };
  const cells = columns.map((c) => byHeader[c.header] ?? null);

  const row = sheet.addRow(cells);
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    const spec = columns[col - 1];
    cell.font = { name: FONT_NAME, size: BODY_SIZE, bold: true };
    cell.alignment = { horizontal: spec.align, vertical: 'middle' };
    cell.border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF000000' } } };
    if (spec.numFmt && cell.value !== null) cell.numFmt = spec.numFmt;
  });
}

/**
 * Draws the sector pie to a canvas and returns it as a PNG data URL.
 *
 * ExcelJS has no chart API — it cannot emit a native, data-bound Excel chart —
 * so the pie ships as an embedded image beside a live table of the same
 * numbers. Rendered at 2x and scaled down on insert so it stays sharp on a
 * high-DPI screen and in print.
 *
 * Returns null when there is no canvas (server-side rendering, or a test
 * environment); callers fall back to the table alone rather than failing the
 * whole export for a decorative element.
 */
function renderSectorPiePng(slices: SectorSlice[]): string | null {
  if (typeof document === 'undefined' || slices.length === 0) return null;

  const SCALE = 2;
  const W = 420;
  const H = 260;
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  const cx = 130;
  const cy = H / 2;
  const radius = 100;

  // Start at 12 o'clock and sweep clockwise, which is how the reference
  // workbook's charts read.
  let angle = -Math.PI / 2;
  for (const slice of slices) {
    const sweep = slice.weight * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = `#${slice.color}`;
    ctx.fill();
    // Hairline separator so neighbouring slices stay distinct when two sectors
    // are close in size.
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    angle += sweep;
  }

  // Legend, one row per slice, to the right of the pie.
  const legendX = 250;
  const lineHeight = 18;
  const legendTop = cy - (slices.length * lineHeight) / 2 + 6;
  ctx.textBaseline = 'middle';
  slices.forEach((slice, i) => {
    const y = legendTop + i * lineHeight;
    ctx.fillStyle = `#${slice.color}`;
    ctx.fillRect(legendX, y - 5, 10, 10);
    ctx.fillStyle = '#000000';
    ctx.font = '11px Perpetua, Georgia, serif';
    const pct = `${Math.round(slice.weight * 100)}%`;
    // Long sector names are clipped rather than wrapped so every legend row
    // stays one line and aligned with its swatch.
    const label = slice.label.length > 20 ? `${slice.label.slice(0, 19)}…` : slice.label;
    ctx.fillText(`${label} — ${pct}`, legendX + 16, y);
  });

  return canvas.toDataURL('image/png');
}

/**
 * The sector allocation block: a heading, a table of sectors with values and
 * weights, and the pie image beside it. Written below the TOTAL with a blank
 * spacer row, so the positions table above stays a clean rectangular range that
 * still sorts and filters on its own.
 *
 * Indented to start at column C rather than A: the narrow 'Sr No' and 'Symbol'
 * widths above clipped the sector names, whereas column C carries the wide
 * 'Name' width and gives every label room to read in full.
 */
const SECTOR_FIRST_COL = 3;
const SECTOR_LAST_COL = SECTOR_FIRST_COL + 2;

function addSectorAllocationBlock(
  wb: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  slices: SectorSlice[]
): void {
  if (slices.length === 0) return;

  /** Places values at SECTOR_FIRST_COL, leaving the columns to their left blank. */
  const indented = (cells: Array<string | number>) => [
    ...Array(SECTOR_FIRST_COL - 1).fill(null),
    ...cells,
  ];
  /** True for the label column, which stays left-aligned while the figures don't. */
  const isLabelCol = (col: number) => col === SECTOR_FIRST_COL;
  const inBlock = (col: number) => col >= SECTOR_FIRST_COL && col <= SECTOR_LAST_COL;

  sheet.addRow([]);
  const headingRow = sheet.addRow(indented(['Sector Allocation']));
  const headingCell = headingRow.getCell(SECTOR_FIRST_COL);
  headingCell.font = { name: FONT_NAME, size: HEADING_SIZE, bold: true };
  headingRow.height = 20;

  const firstDataRow = sheet.rowCount + 1;

  const header = sheet.addRow(indented(['Sector', 'Value', '% of Portfolio']));
  header.eachCell((cell, col) => {
    if (!inBlock(col)) return;
    cell.font = { name: FONT_NAME, size: BODY_SIZE, bold: true };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: isLabelCol(col) ? 'left' : 'center', vertical: 'middle' };
  });

  for (const slice of slices) {
    const row = sheet.addRow(indented([slice.label, slice.value, slice.weight]));
    row.eachCell((cell, col) => {
      if (!inBlock(col)) return;
      cell.font = { name: FONT_NAME, size: BODY_SIZE };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: isLabelCol(col) ? 'left' : 'right', vertical: 'middle' };
      if (col === SECTOR_FIRST_COL + 1) cell.numFmt = WHOLE_NUMBER;
      if (col === SECTOR_LAST_COL) cell.numFmt = WHOLE_PERCENT;
    });
    // The swatch on the label cell ties each row to its slice in the pie.
    row.getCell(SECTOR_FIRST_COL).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: `FF${slice.color}` },
    };
  }

  const totalRow = sheet.addRow(
    indented([
      'TOTAL',
      slices.reduce((s, x) => s + x.value, 0),
      slices.reduce((s, x) => s + x.weight, 0),
    ])
  );
  totalRow.eachCell((cell, col) => {
    if (!inBlock(col)) return;
    cell.font = { name: FONT_NAME, size: BODY_SIZE, bold: true };
    cell.alignment = { horizontal: isLabelCol(col) ? 'left' : 'right', vertical: 'middle' };
    cell.border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF000000' } } };
    if (col === SECTOR_FIRST_COL + 1) cell.numFmt = WHOLE_NUMBER;
    if (col === SECTOR_LAST_COL) cell.numFmt = WHOLE_PERCENT;
  });

  const png = renderSectorPiePng(slices);
  if (!png) return;

  const imageId = wb.addImage({ base64: png, extension: 'png' });
  // Anchored just past the table's last column so it clears it, and sized in
  // points rather than by cell range so the pie keeps its aspect ratio
  // regardless of the column widths above it.
  sheet.addImage(imageId, {
    tl: { col: SECTOR_LAST_COL + 1, row: firstDataRow - 1 },
    ext: { width: 420, height: 260 },
  });
}

/** Builds the workbook and hands it to the browser as an .xlsx download. */
export async function downloadClientHoldingsWorkbook(
  clientName: string,
  rows: HoldingsExportRow[],
  cashBalance = 0
): Promise<void> {
  const wb = buildClientHoldingsWorkbook(clientName, rows, cashBalance);
  await saveWorkbook(wb, `${slugify(clientName)}-holdings.xlsx`);
}

/**
 * The merged household portfolio in the firm's reference format — the same
 * sheet an individual client gets (borders, Perpetua, whole numbers, the %PL
 * gain/loss tints, the allocation gradient and the sector allocation block with
 * its pie), plus an "Accounts" column showing how many of the household's
 * mandates hold each name.
 *
 * `cashBalance` is the household's combined cash across every member account,
 * so the sheet foots to the same portfolio value the family drawer reports.
 */
export async function downloadFamilyHoldingsWorkbook(
  familyName: string,
  rows: HoldingsExportRow[],
  cashBalance = 0
): Promise<void> {
  const wb = buildClientHoldingsWorkbook(familyName, rows, cashBalance, 'family');
  await saveWorkbook(wb, `${slugify(familyName)}-family-holdings.xlsx`);
}

function slugify(name: string): string {
  return name.replace(/\s+/g, '_').toLowerCase();
}

async function saveWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
