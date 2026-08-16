import ExcelJS from 'exceljs';
import { PerformanceOk, PerformanceResponse } from './performance.api';

/**
 * The client-facing Performance statement, laid out as the firm's reference
 * workbook ("portfolio performance report.xlsx"): a navy banner, an identity
 * block, and three labelled panels — PORTFOLIO OVERVIEW and CASH FLOWS & GAINS
 * down the left, PERFORMANCE METRICS down the right.
 *
 * This replaces the two-column CSV the page used to emit. The CSV carried the
 * same numbers but none of the framing that makes a statement readable by the
 * client rather than by the engine: no grouping, no units on the rates, and a
 * raw `0.333` where a benchmark return belongs.
 *
 * Layout constants below are taken from the reference file cell-for-cell, so a
 * generated sheet and the reference open as the same document.
 */

const FONT = 'Arial';

/** The firm's palette, as sampled from the reference workbook. */
const NAVY = 'FF0B1F3A';
const NAVY_LIGHT = 'FF16305C';
const GOLD_TEXT = 'FFC9A227';
const GOLD_FILL = 'FFF4E9C7';
const STONE = 'FFF7F5F0';
const WHITE = 'FFFFFFFF';
const GREY_TEXT = 'FF5B6472';
const INK = 'FF1A1A1A';
/** Calculated figures read blue; input/derived-from-ledger figures read near-black. */
const CALC_BLUE = 'FF1F4E9C';
const HAIRLINE = 'FFD9D9D9';

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: HAIRLINE } },
  bottom: { style: 'thin', color: { argb: HAIRLINE } },
  left: { style: 'thin', color: { argb: HAIRLINE } },
  right: { style: 'thin', color: { argb: HAIRLINE } },
};

/**
 * Negatives render in parentheses rather than with a minus sign — the
 * accounting convention the reference workbook uses, and the one the firm's
 * other client statements follow.
 */
const MONEY = '#,##0;(#,##0)';
const PERCENT = '0.0%;-0.0%';
/** Cash drag and turnover are small positives; they never need the negative arm. */
const PERCENT_PLAIN = '0.0%';
const DATE_FMT = 'dd-mm-yyyy';

/** Rows alternate stone and white, as in the reference file. */
type Band = 'stone' | 'white';
const bandFill = (band: Band): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: band === 'stone' ? STONE : WHITE },
});

/**
 * One line of a panel: a label on the left, a value on the right. `kind` picks
 * the number format and, with it, how the value is read — money, a rate, a
 * plain string (a benchmark code), or a date.
 */
interface Line {
  label: string;
  value: number | string | Date | null;
  kind: 'money' | 'percent' | 'percentPlain' | 'text' | 'date';
  /**
   * Emphasised total line — gold fill, heavier type. Used for Portfolio Value
   * and Total Gain, the two figures a client looks for first.
   */
  total?: boolean;
  /**
   * True when the figure comes straight from the ledger rather than being
   * derived. Reference workbook renders these in near-black and the calculated
   * ones in blue; the footer note explains the distinction.
   */
  input?: boolean;
}

/**
 * A value the engine could not produce. Written as the literal text rather than
 * left blank or zeroed: an empty cell reads as "nothing happened" and a 0.0%
 * reads as "we measured this and it was zero", when the truth is neither.
 */
const NOT_AVAILABLE = 'Not available';

/** Renders a nullable engine rate as either its number or the n/a text. */
function rate(v: number | null | undefined): number | string {
  return v ?? NOT_AVAILABLE;
}

/**
 * The window the sheet covers. The since-inception engine measures from the
 * client's first flow to the as-of date, so the sheet says exactly that rather
 * than borrowing the reference file's "YTD" — a label that would be wrong for
 * every client whose book did not open on 1 January.
 */
function timeFrameLabel(data: PerformanceOk, asOf: Date): string {
  const from = new Date(data.inceptionDate);
  if (Number.isNaN(from.getTime())) return 'Since Inception';
  return `Since Inception (${fmtDate(from)} → ${fmtDate(asOf)})`;
}

function fmtDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/**
 * The left column's panels. Portfolio Value and Total Gain are marked as
 * totals; everything else is a component of one of them.
 */
function leftPanels(data: PerformanceOk): Array<{ title: string; lines: Line[] }> {
  return [
    {
      title: 'PORTFOLIO OVERVIEW',
      lines: [
        { label: 'Portfolio Value', value: data.portfolioValue, kind: 'money', total: true },
        { label: 'Holdings Value', value: data.holdingsValue, kind: 'money', input: true },
        { label: 'Cash Balance', value: data.cashBalance, kind: 'money', input: true },
        { label: 'Invested Capital', value: data.investedCapital, kind: 'money', input: true },
      ],
    },
    {
      title: 'CASH FLOWS & GAINS',
      lines: [
        { label: 'Realized Proceeds', value: data.realizedProceeds, kind: 'money', input: true },
        { label: 'Net Deposits', value: data.netDeposits, kind: 'money', input: true },
        { label: 'Net Withdrawals', value: data.netWithdrawals, kind: 'money', input: true },
        { label: 'Realized Gain', value: data.realizedGain, kind: 'money' },
        { label: 'Unrealized Gain', value: data.unrealizedGain, kind: 'money' },
        { label: 'Total Gain', value: data.totalGain, kind: 'money', total: true },
        { label: 'Dividend Income', value: data.dividendIncome, kind: 'money', input: true },
        { label: 'Fees', value: data.fees, kind: 'money', input: true },
      ],
    },
  ];
}

/**
 * The right column — every rate the engine reports, in the reference file's
 * order. Benchmark identity sits between the portfolio's own returns and the
 * alpha figures, so the reader meets the comparator before the comparison.
 */
function rightLines(data: PerformanceOk): Line[] {
  return [
    { label: 'XIRR (Annualized)', value: rate(data.xirr), kind: 'percent' },
    { label: 'Interim Return', value: rate(data.interimReturn), kind: 'percent' },
    { label: 'Absolute Return', value: rate(data.absoluteReturn), kind: 'percent' },
    { label: 'Annualized Return', value: rate(data.annualizedReturn), kind: 'percent' },
    { label: 'Benchmark', value: data.benchmark?.code ?? NOT_AVAILABLE, kind: 'text' },
    { label: 'Benchmark XIRR', value: rate(data.benchmark?.xirr), kind: 'percent' },
    { label: 'Alpha (Annualized)', value: rate(data.alpha), kind: 'percent' },
    { label: 'Alpha (Interim)', value: rate(data.alphaInterim), kind: 'percent' },
    { label: 'Cash Drag', value: rate(data.cashDrag), kind: 'percentPlain' },
    { label: 'Portfolio Turnover', value: rate(data.portfolioTurnover), kind: 'percentPlain' },
  ];
}

/** Column geometry, straight from the reference file. C is the gutter. */
const COL_WIDTHS = [30, 24, 3, 30, 24];

/** First row of the panel bodies — banner, identity block and headers sit above. */
const PANEL_HEADER_ROW = 8;
const FIRST_BODY_ROW = 9;

/**
 * Builds the statement workbook for one client.
 *
 * `currency` decides both the money format and the footer's units note: the US
 * book reports dollars in thousands-separated numbering, the Indian book rupees
 * in lakh/crore. Everything else about the sheet is identical between the two.
 */
export function buildPerformanceWorkbook(
  clientName: string,
  result: PerformanceResponse,
  currency: string,
): ExcelJS.Workbook {
  const { data, meta } = result;
  if (data.status !== 'ok') {
    throw new Error('Performance could not be computed for this client');
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Giriraj Global Capital';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Performance Summary', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true },
  });
  sheet.columns = COL_WIDTHS.map((width) => ({ width }));

  const asOf = new Date(meta.asOf);
  writeBanner(sheet);
  writeIdentity(sheet, clientName, asOf, timeFrameLabel(data, asOf));

  const left = leftPanels(data);
  const right = rightLines(data);

  // Both columns start on the same row so the two panels read as one grid, and
  // the left column's second panel gets its own header further down.
  writePanelHeader(sheet, PANEL_HEADER_ROW, 1, left[0].title);
  writePanelHeader(sheet, PANEL_HEADER_ROW, 4, 'PERFORMANCE METRICS');

  let row = FIRST_BODY_ROW;
  const leftBlockOne = left[0].lines;
  leftBlockOne.forEach((line, i) => {
    writeLine(sheet, row + i, 1, line, i % 2 === 0 ? 'stone' : 'white', currency);
  });

  // The right column runs uninterrupted past the left column's panel break, so
  // its banding is indexed independently of the left's.
  right.forEach((line, i) => {
    const target = FIRST_BODY_ROW + i;
    // Row 15 carries the left column's second panel header; the right column's
    // line for that row still belongs in the metrics list beside it.
    writeLine(sheet, target, 4, line, i % 2 === 0 ? 'stone' : 'white', currency);
  });

  // The second left panel opens two rows below the first panel's last line.
  // The gap is deliberately wider than a single blank cell: the right column
  // runs straight through this row, and a one-row gap put the CASH FLOWS bar
  // level with a metrics line, making the two columns read as one row.
  row = FIRST_BODY_ROW + leftBlockOne.length + 2;
  sheet.getRow(row - 1).height = 9.75;

  writePanelHeader(sheet, row, 1, left[1].title);
  row += 1;
  left[1].lines.forEach((line, i) => {
    writeLine(sheet, row + i, 1, line, i % 2 === 0 ? 'stone' : 'white', currency);
  });
  row += left[1].lines.length;

  writeFooter(sheet, row + 1, currency, meta.warnings);

  return wb;
}

/** The navy masthead: title bar over a gold-italic confidentiality strip. */
function writeBanner(sheet: ExcelJS.Worksheet): void {
  sheet.mergeCells('A1:E1');
  const title = sheet.getCell('A1');
  title.value = 'PORTFOLIO PERFORMANCE REPORT';
  title.font = { name: FONT, size: 20, bold: true, color: { argb: WHITE } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  title.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 42;

  sheet.mergeCells('A2:E2');
  const sub = sheet.getCell('A2');
  sub.value = 'Private Wealth  |  Confidential Client Statement';
  sub.font = { name: FONT, size: 10.5, italic: true, color: { argb: GOLD_TEXT } };
  sub.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY_LIGHT } };
  sub.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getRow(2).height = 19.5;

  sheet.getRow(3).height = 7.5;
}

/** Who the statement is for, when it was struck, and what window it covers. */
function writeIdentity(
  sheet: ExcelJS.Worksheet,
  clientName: string,
  asOf: Date,
  timeFrame: string,
): void {
  const rows: Array<[string, string | Date, 'text' | 'date']> = [
    ['Client Name', clientName, 'text'],
    ['As of', asOf, 'date'],
    ['Data Time Frame', timeFrame, 'text'],
  ];

  rows.forEach(([label, value, kind], i) => {
    const r = 4 + i;
    sheet.getRow(r).height = 19.5;

    const labelCell = sheet.getCell(r, 1);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: 10.5, color: { argb: GREY_TEXT } };
    labelCell.fill = bandFill('stone');
    labelCell.border = BORDER;
    labelCell.alignment = { horizontal: 'left', vertical: 'middle' };

    const valueCell = sheet.getCell(r, 2);
    valueCell.value = value;
    valueCell.font = { name: FONT, size: label === 'Client Name' ? 12 : 11, bold: true, color: { argb: label === 'Client Name' ? NAVY : INK } };
    valueCell.fill = bandFill('stone');
    valueCell.border = BORDER;
    valueCell.alignment = { horizontal: 'left', vertical: 'middle' };
    if (kind === 'date') valueCell.numFmt = DATE_FMT;
  });

  sheet.getRow(7).height = 9.75;
}

/** A navy section bar spanning the panel's label and value columns. */
function writePanelHeader(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  title: string,
): void {
  sheet.mergeCells(row, col, row, col + 1);
  const cell = sheet.getCell(row, col);
  cell.value = title;
  cell.font = { name: FONT, size: 11, bold: true, color: { argb: WHITE } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getRow(row).height = 21.75;
}

/** One label/value pair, formatted by kind and banded by position. */
function writeLine(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  line: Line,
  band: Band,
  currency: string,
): void {
  const fill: ExcelJS.Fill = line.total
    ? { type: 'pattern', pattern: 'solid', fgColor: { argb: GOLD_FILL } }
    : bandFill(band);

  const labelCell = sheet.getCell(row, col);
  labelCell.value = line.label;
  labelCell.font = line.total
    ? { name: FONT, size: 11, bold: true, color: { argb: NAVY } }
    : { name: FONT, size: 10.5, color: { argb: GREY_TEXT } };
  labelCell.fill = fill;
  labelCell.border = BORDER;
  labelCell.alignment = { horizontal: 'left', vertical: 'middle' };

  const valueCell = sheet.getCell(row, col + 1);
  valueCell.value = line.value;
  valueCell.fill = fill;
  valueCell.border = BORDER;
  valueCell.alignment = { horizontal: 'right', vertical: 'middle' };
  valueCell.font = line.total
    ? { name: FONT, size: 11.5, bold: true, color: { argb: NAVY } }
    : { name: FONT, size: 11, bold: true, color: { argb: line.input ? INK : CALC_BLUE } };

  // A rate the engine could not produce arrives here as text, and a percent
  // format applied to text would render nothing at all — so the format is only
  // set when there is actually a number under it.
  if (typeof line.value === 'number') {
    if (line.kind === 'money') valueCell.numFmt = moneyFormat(currency);
    else if (line.kind === 'percent') valueCell.numFmt = PERCENT;
    else if (line.kind === 'percentPlain') valueCell.numFmt = PERCENT_PLAIN;
  }
}

/**
 * The money format for a book. Both markets report whole units with negatives
 * in parentheses; they differ only in the symbol, which is carried in the cell
 * format rather than in the label so the cells stay numeric and sortable.
 */
function moneyFormat(currency: string): string {
  const symbol = currency === 'INR' ? '₹' : '$';
  return `"${symbol}"${MONEY.split(';')[0]};("${symbol}"${MONEY.split(';')[0]})`;
}

/**
 * The legend, the units note, and any data-integrity warnings the engine
 * raised. Warnings travel onto the statement rather than being dropped at the
 * screen: a cash balance the ledger cannot explain changes how every figure
 * above should be read, and the client's copy is exactly where that belongs.
 */
function writeFooter(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  currency: string,
  warnings: string[],
): void {
  const units =
    currency === 'INR'
      ? 'Figures in ₹, Indian numbering (lakh/crore)'
      : 'Figures in $, thousands separated';

  let row = startRow + 1;

  const legend = sheet.getCell(row, 1);
  sheet.mergeCells(row, 1, row, 5);
  legend.value = `Blue text = calculated field   |   Black text = as recorded   |   ${units}`;
  legend.font = { name: FONT, size: 9, italic: true, color: { argb: GREY_TEXT } };
  legend.alignment = { horizontal: 'left', vertical: 'middle' };
  row += 1;

  for (const warning of warnings) {
    sheet.mergeCells(row, 1, row, 5);
    const cell = sheet.getCell(row, 1);
    cell.value = `Note: ${warning}`;
    cell.font = { name: FONT, size: 8.5, italic: true, color: { argb: GREY_TEXT } };
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
    row += 1;
  }

  sheet.mergeCells(row, 1, row, 5);
  const disclaimer = sheet.getCell(row, 1);
  disclaimer.value =
    'This statement is generated for informational purposes only and does not constitute investment advice.';
  disclaimer.font = { name: FONT, size: 8.5, italic: true, color: { argb: GREY_TEXT } };
  disclaimer.alignment = { horizontal: 'left', vertical: 'middle' };
}

/** Builds the statement and hands it to the browser as an .xlsx download. */
export async function downloadPerformanceWorkbook(
  clientName: string,
  result: PerformanceResponse,
  currency: string,
): Promise<void> {
  const wb = buildPerformanceWorkbook(clientName, result, currency);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const asOf = new Date(result.meta.asOf).toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${clientName.replace(/\s+/g, '_').toLowerCase()}-performance-${asOf}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
