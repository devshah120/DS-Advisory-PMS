import ExcelJS from 'exceljs';
import { PerformanceOk, PerformanceResponse } from './performance.api';
import { PeriodReturn, PortfolioAsOf } from './portfolio-history.api';
import { FamilyMemberPerformance, FamilyPeriodReturn } from './family-performance.api';
import { returnBasis } from './returnBasis';
import {
  applyWorkbookFont,
  EXCEL_BODY_SIZE,
  EXCEL_FONT,
  EXCEL_HEADER_SIZE,
  EXCEL_TITLE_SIZE,
} from './excelFont';

/**
 * The client-facing Performance statement: a navy banner, an identity block,
 * and labelled panels — the summary down the left, PERFORMANCE METRICS down the
 * right.
 *
 * This file owns WHAT the statement says (which figures, in which order, under
 * which labels); `performancePdf.ts` imports the same builders and owns only
 * how they are drawn, so the PDF and the workbook can never disagree.
 */

const FONT = EXCEL_FONT;

/** Monochromatic navy palette, ARGB. Mirrors pdfChrome.ts. */
export const NAVY = 'FF1B365D';
export const LIGHT_NAVY = 'FFEDF2F8';
export const ZEBRA = 'FFF7F9FC';
export const BORDER_COLOR = 'FFCBD5E1';
export const INK = 'FF0F172A';
export const MUTED = 'FF475569';
const WHITE = 'FFFFFFFF';

const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: BORDER_COLOR } },
  bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
  left: { style: 'thin', color: { argb: BORDER_COLOR } },
  right: { style: 'thin', color: { argb: BORDER_COLOR } },
};

/** Whole units, plain leading minus. The currency is stated once, in the caption. */
const MONEY = '#,##0;-#,##0';
/** Two decimals throughout, signed, matching the PDF and the dashboard. */
const PERCENT = '+0.00%;-0.00%;0.00%';
/** Weights, cash drag, turnover: never negative, never signed. */
const PERCENT_PLAIN = '0.00%';
const DATE_FMT = 'dd-mm-yyyy';

type Band = 'zebra' | 'white';
const solid = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const bandFill = (band: Band): ExcelJS.Fill => solid(band === 'zebra' ? ZEBRA : WHITE);
const bandOf = (i: number): Band => (i % 2 === 0 ? 'white' : 'zebra');

/**
 * One line of a panel: a label on the left, a value on the right. `kind` picks
 * the number format and, with it, how the value is read.
 */
export interface Line {
  label: string;
  value: number | string | Date | null;
  kind: 'money' | 'percent' | 'percentPlain' | 'text' | 'date';
  /** Emphasised summary line — light-navy fill, bold. */
  total?: boolean;
  /** True when the figure comes straight from the ledger rather than being derived. */
  input?: boolean;
}

/**
 * A value the engine could not produce. Written as text rather than left blank
 * or zeroed: a 0.00% reads as "we measured this and it was zero".
 */
export const NOT_AVAILABLE = 'Not available';

/** Renders a nullable engine rate as either its number or the n/a text. */
export function rate(v: number | null | undefined): number | string {
  return v ?? NOT_AVAILABLE;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

export function fmtDate(d: Date): string {
  return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** "01 Oct 2026" — spelled by hand; en-GB's ICU month for September is "Sept". */
export function fmtLongDate(d: Date | string): string {
  const x = new Date(d);
  return `${pad2(x.getDate())} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}

/** "01 Oct 2026 – 15 Nov 2026". */
export function fmtRange(from: Date | string, to: Date | string): string {
  return `${fmtLongDate(from)} – ${fmtLongDate(to)}`;
}

export function amountsCaption(currency: string): string {
  if (currency === 'INR') return 'All amounts in ₹ (Indian Rupees)';
  if (currency === 'USD') return 'All amounts in $ (US Dollars)';
  return `All amounts in ${currency}`;
}

/** The single closing line on every performance statement, PDF and workbook alike. */
export const STATEMENT_FOOTER =
  'Returns are money-weighted over the reporting period. Generated for informational and reporting purposes only.';

/* ────────────────────────────────────────────────────────────────────────────
 * Since-inception statement (US book).
 * ──────────────────────────────────────────────────────────────────────────── */

function timeFrameLabel(data: PerformanceOk, asOf: Date): string {
  const from = new Date(data.inceptionDate);
  if (Number.isNaN(from.getTime())) return 'Since inception';
  return `Since inception, ${fmtRange(from, asOf)}`;
}

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

/** Column geometry. C is the gutter. */
const COL_WIDTHS = [30, 24, 3, 30, 24];

/** Row 7 carries the amounts caption; panel headers sit on row 8. */
const CAPTION_ROW = 7;
const PANEL_HEADER_ROW = 8;
const FIRST_BODY_ROW = 9;

export function buildPerformanceWorkbook(
  clientName: string,
  result: PerformanceResponse,
  currency: string,
): ExcelJS.Workbook {
  const { data, meta } = result;
  if (data.status !== 'ok') {
    throw new Error('Performance could not be computed for this client');
  }

  const wb = newWorkbook();
  const sheet = summarySheet(wb, 'Performance Summary');

  const asOf = new Date(meta.asOf);
  writeBanner(sheet);
  writeIdentity(sheet, 'Client', clientName, asOf, timeFrameLabel(data, asOf));
  writeCaption(sheet, currency);

  const left = leftPanels(data);
  const right = rightLines(data);

  writePanelHeader(sheet, PANEL_HEADER_ROW, 1, left[0].title);
  writePanelHeader(sheet, PANEL_HEADER_ROW, 4, 'PERFORMANCE METRICS');

  left[0].lines.forEach((line, i) => writeLine(sheet, FIRST_BODY_ROW + i, 1, line, bandOf(i)));
  right.forEach((line, i) => writeLine(sheet, FIRST_BODY_ROW + i, 4, line, bandOf(i)));

  // Two rows of air before the second left panel so its header never sits
  // level with a metrics line and reads as part of the right column.
  let row = FIRST_BODY_ROW + left[0].lines.length + 2;
  sheet.getRow(row - 1).height = 9.75;
  writePanelHeader(sheet, row, 1, left[1].title);
  row += 1;
  left[1].lines.forEach((line, i) => writeLine(sheet, row + i, 1, line, bandOf(i)));
  row += left[1].lines.length;

  writeFooter(sheet, Math.max(row, FIRST_BODY_ROW + right.length) + 1, meta.warnings);
  return wb;
}

function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Giriraj Global Consultants';
  wb.created = new Date();
  return wb;
}

function summarySheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet(name, {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true },
  });
  sheet.columns = COL_WIDTHS.map((width) => ({ width }));
  return sheet;
}

/** The navy masthead: the firm's name over the reporting strapline. */
function writeBanner(sheet: ExcelJS.Worksheet): void {
  sheet.mergeCells('A1:E1');
  const title = sheet.getCell('A1');
  title.value = 'GIRIRAJ GLOBAL CONSULTANTS';
  title.font = { name: FONT, size: EXCEL_TITLE_SIZE, bold: true, color: { argb: WHITE } };
  title.fill = solid(NAVY);
  title.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 34;

  sheet.mergeCells('A2:E2');
  const sub = sheet.getCell('A2');
  sub.value = 'Portfolio Analytics & Reporting';
  sub.font = { name: FONT, size: EXCEL_BODY_SIZE, color: { argb: LIGHT_NAVY } };
  sub.fill = solid(NAVY);
  sub.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getRow(2).height = 18;

  sheet.getRow(3).height = 7.5;
}

/** Who the statement is for, when it was struck, and what window it covers. */
function writeIdentity(
  sheet: ExcelJS.Worksheet,
  subjectLabel: string,
  subject: string,
  asOf: Date,
  timeFrame: string,
): void {
  const rows: Array<[string, string | Date, 'text' | 'date']> = [
    [subjectLabel, subject, 'text'],
    ['As of', asOf, 'date'],
    ['Period', timeFrame, 'text'],
  ];

  rows.forEach(([label, value, kind], i) => {
    const r = 4 + i;
    sheet.getRow(r).height = 19.5;

    const labelCell = sheet.getCell(r, 1);
    labelCell.value = label;
    labelCell.font = { name: FONT, size: EXCEL_BODY_SIZE, color: { argb: MUTED } };
    labelCell.fill = bandFill('white');
    labelCell.border = BORDER;
    labelCell.alignment = { horizontal: 'left', vertical: 'middle' };

    const valueCell = sheet.getCell(r, 2);
    valueCell.value = value;
    valueCell.font = {
      name: FONT,
      size: i === 0 ? EXCEL_HEADER_SIZE : EXCEL_BODY_SIZE,
      bold: true,
      color: { argb: INK },
    };
    valueCell.fill = bandFill('white');
    valueCell.border = BORDER;
    valueCell.alignment = { horizontal: 'left', vertical: 'middle' };
    if (kind === 'date') valueCell.numFmt = DATE_FMT;
  });
}

/** "All amounts in ₹ (Indian Rupees)", right-aligned above the panels. */
function writeCaption(sheet: ExcelJS.Worksheet, currency: string): void {
  sheet.mergeCells(CAPTION_ROW, 4, CAPTION_ROW, 5);
  const cell = sheet.getCell(CAPTION_ROW, 4);
  cell.value = amountsCaption(currency);
  cell.font = { name: FONT, size: EXCEL_BODY_SIZE, italic: true, color: { argb: MUTED } };
  cell.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(CAPTION_ROW).height = 18;
}

/** A navy section bar spanning the panel's label and value columns. */
function writePanelHeader(sheet: ExcelJS.Worksheet, row: number, col: number, title: string): void {
  sheet.mergeCells(row, col, row, col + 1);
  const cell = sheet.getCell(row, col);
  cell.value = title;
  cell.font = { name: FONT, size: EXCEL_HEADER_SIZE, bold: true, color: { argb: WHITE } };
  cell.fill = solid(NAVY);
  cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getRow(row).height = 21.75;
}

/** One label/value pair, formatted by kind and banded by position. */
function writeLine(sheet: ExcelJS.Worksheet, row: number, col: number, line: Line, band: Band): void {
  const fill = line.total ? solid(LIGHT_NAVY) : bandFill(band);
  const font: Partial<ExcelJS.Font> = {
    name: FONT,
    size: EXCEL_BODY_SIZE,
    bold: !!line.total,
    color: { argb: INK },
  };

  const labelCell = sheet.getCell(row, col);
  labelCell.value = line.label;
  labelCell.font = font;
  labelCell.fill = fill;
  labelCell.border = BORDER;
  labelCell.alignment = { horizontal: 'left', vertical: 'middle' };

  const valueCell = sheet.getCell(row, col + 1);
  valueCell.value = line.value;
  valueCell.font = font;
  valueCell.fill = fill;
  valueCell.border = BORDER;
  valueCell.alignment = { horizontal: 'right', vertical: 'middle' };

  // A rate the engine could not produce arrives as text; a percent format on
  // text renders nothing, so the format is only set over an actual number.
  if (typeof line.value === 'number') {
    if (line.kind === 'money') valueCell.numFmt = MONEY;
    else if (line.kind === 'percent') valueCell.numFmt = PERCENT;
    else if (line.kind === 'percentPlain') valueCell.numFmt = PERCENT_PLAIN;
  }
}

/** Any material caveats, then the one-line institutional footer. */
function writeFooter(sheet: ExcelJS.Worksheet, startRow: number, notes: string[]): void {
  let row = startRow + 1;
  for (const text of [...notes, STATEMENT_FOOTER]) {
    sheet.mergeCells(row, 1, row, 5);
    const cell = sheet.getCell(row, 1);
    cell.value = text;
    cell.font = { name: FONT, size: EXCEL_BODY_SIZE, italic: true, color: { argb: MUTED } };
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    row += 1;
  }
}

async function saveWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  applyWorkbookFont(wb);
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

export async function downloadPerformanceWorkbook(
  clientName: string,
  result: PerformanceResponse,
  currency: string,
): Promise<void> {
  const wb = buildPerformanceWorkbook(clientName, result, currency);
  const asOf = new Date(result.meta.asOf).toISOString().slice(0, 10);
  await saveWorkbook(wb, `${clientName.replace(/\s+/g, '_').toLowerCase()}-performance-${asOf}.xlsx`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * The period statement — one SELECTED window (the Indian book's export).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The window, as its real dates. A clamp to the 30-June inception changes what
 * the return measures, so it is the one qualifier kept on the line.
 */
function windowLabel(r: {
  from: string;
  to: string;
  clampedToInception: boolean;
  daysClamped: number;
}): string {
  const base = fmtRange(r.from, r.to);
  if (r.clampedToInception && r.daysClamped > 0) {
    const days = `${r.daysClamped} day${r.daysClamped === 1 ? '' : 's'}`;
    return `${base} · opened at inception, ${days} short of the full window`;
  }
  return base;
}

export function periodTimeFrameLabel(pr: PeriodReturn): string {
  return windowLabel(pr);
}

export function familyTimeFrameLabel(fr: FamilyPeriodReturn): string {
  return windowLabel(fr);
}

/** The KPI headline's caption on the active basis. */
export function headlineLabel(r: PeriodReturn | FamilyPeriodReturn): string {
  return returnBasis(r).annual ? 'Annualized Return (XIRR)' : 'Period Return';
}

/**
 * The PERFORMANCE METRICS column, bound to `returnBasis()` — the same function
 * the dashboard uses.
 *
 * Under 365 days every rate is a de-annualized period figure: the portfolio's
 * period MWRR, the benchmark's `interim` on the same flows, and their spread.
 * Reading `benchmark.xirr` here instead put an annualized benchmark (+98.00%
 * on a 45-day window) beside a period portfolio return (-0.61%), with an alpha
 * (-9.40%) that reconciled to neither. At 365 days and over, all three switch
 * to per-annum together.
 */
function metricLines(r: PeriodReturn | FamilyPeriodReturn): Line[] {
  const b = returnBasis(r);
  const benchmarkName = r.benchmark?.name ?? r.benchmark?.code ?? NOT_AVAILABLE;

  const lines: Line[] = b.annual
    ? [
        { label: 'Annualized Return (XIRR)', value: rate(r.annualizedReturnPct), kind: 'percent' },
        { label: 'Cumulative Return', value: rate(r.returnPct), kind: 'percent' },
        { label: 'Benchmark', value: benchmarkName, kind: 'text' },
        { label: 'Benchmark Return (p.a.)', value: rate(b.benchmark), kind: 'percent' },
        { label: 'Alpha (p.a.)', value: rate(b.alpha), kind: 'percent' },
      ]
    : [
        { label: 'Period Return', value: rate(r.returnPct), kind: 'percent' },
        { label: 'Annualized Return', value: rate(r.annualizedReturnPct), kind: 'percent' },
        { label: 'Benchmark', value: benchmarkName, kind: 'text' },
        { label: 'Benchmark Return', value: rate(b.benchmark), kind: 'percent' },
        { label: 'Alpha', value: rate(b.alpha), kind: 'percent' },
      ];

  // Why a rate is missing belongs beside where the rate would have been.
  if (b.portfolio == null && r.returnReason) {
    lines.push({ label: 'Return unavailable', value: r.returnReason, kind: 'text', input: true });
  }
  if (r.benchmark && b.benchmark == null && r.benchmark.reason) {
    lines.push({ label: 'Benchmark unavailable', value: r.benchmark.reason, kind: 'text', input: true });
  }
  return lines;
}

export function periodRightLines(pr: PeriodReturn): Line[] {
  return metricLines(pr);
}

export function familyRightLines(fr: FamilyPeriodReturn): Line[] {
  return metricLines(fr);
}

/**
 * The left column. Opening, net flows and closing sit together because that is
 * the arithmetic the reader checks: closing − opening − flows is the gain.
 */
export function periodLeftPanels(
  pr: PeriodReturn,
  asOf: PortfolioAsOf | null,
): Array<{ title: string; lines: Line[] }> {
  const panels: Array<{ title: string; lines: Line[] }> = [
    {
      title: 'PORTFOLIO SUMMARY',
      lines: [
        { label: 'Opening Value', value: pr.openingValue, kind: 'money', input: true },
        { label: 'Net Flows', value: pr.netFlows, kind: 'money', input: true },
        { label: 'Closing Value', value: pr.closingValue, kind: 'money', total: true },
        {
          label: 'Net Gain',
          value: pr.closingValue - pr.openingValue - pr.netFlows,
          kind: 'money',
          total: true,
        },
        { label: 'Period (Days)', value: pr.periodDays, kind: 'text', input: true },
      ],
    },
  ];

  // Omitted rather than zero-filled when the replay could not produce one.
  if (asOf) {
    panels.push({
      title: 'POSITION AT PERIOD END',
      lines: [
        { label: 'Holdings Value', value: asOf.holdingsValue, kind: 'money', input: true },
        { label: 'Cash Balance', value: asOf.cash, kind: 'money', input: true },
        { label: 'Portfolio Value', value: asOf.portfolioValue, kind: 'money', total: true },
        { label: 'Total Cost', value: asOf.totalCost, kind: 'money', input: true },
        { label: 'Unrealized Gain', value: asOf.unrealizedGain, kind: 'money' },
        { label: 'Realized Gain', value: asOf.realizedGain, kind: 'money' },
      ],
    });
  }

  return panels;
}

/**
 * Caveats that change how the figures must be read. Only a ledger gap remains:
 * the window clamp is stated on the period line itself, and the old
 * methodology notes are replaced by the one-line footer.
 */
export function periodNotes(_pr: PeriodReturn, asOf: PortfolioAsOf | null): string[] {
  if (asOf && asOf.cashShortfall > 0) {
    return ['Cash balance was floored at zero during this period; the ledger is incomplete for this window.'];
  }
  return [];
}

export function buildPeriodPerformanceWorkbook(
  clientName: string,
  pr: PeriodReturn,
  asOf: PortfolioAsOf | null,
  currency: string,
): ExcelJS.Workbook {
  const wb = newWorkbook();
  const sheet = summarySheet(wb, 'Performance Summary');

  writeBanner(sheet);
  writeIdentity(sheet, 'Client', clientName, new Date(pr.to), periodTimeFrameLabel(pr));
  writeCaption(sheet, currency);

  const left = periodLeftPanels(pr, asOf);
  const right = periodRightLines(pr);

  writePanelHeader(sheet, PANEL_HEADER_ROW, 1, left[0].title);
  writePanelHeader(sheet, PANEL_HEADER_ROW, 4, 'PERFORMANCE METRICS');

  left[0].lines.forEach((line, i) => writeLine(sheet, FIRST_BODY_ROW + i, 1, line, bandOf(i)));
  right.forEach((line, i) => writeLine(sheet, FIRST_BODY_ROW + i, 4, line, bandOf(i)));

  let row = FIRST_BODY_ROW + left[0].lines.length;
  if (left[1]) {
    row += 2;
    sheet.getRow(row - 1).height = 9.75;
    writePanelHeader(sheet, row, 1, left[1].title);
    row += 1;
    left[1].lines.forEach((line, i) => writeLine(sheet, row + i, 1, line, bandOf(i)));
    row += left[1].lines.length;
  }

  writeFooter(sheet, Math.max(row, FIRST_BODY_ROW + right.length) + 1, periodNotes(pr, asOf));

  if (asOf && asOf.positions.length) writeHoldingsSheet(wb, asOf, currency);
  return wb;
}

/** Writes a full-width navy title bar on row 1 of a detail tab. */
function writeTitleBar(sheet: ExcelJS.Worksheet, columns: number, text: string): void {
  sheet.mergeCells(1, 1, 1, columns);
  const title = sheet.getCell(1, 1);
  title.value = text;
  title.font = { name: FONT, size: EXCEL_TITLE_SIZE, bold: true, color: { argb: WHITE } };
  title.fill = solid(NAVY);
  title.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
  sheet.getRow(1).height = 30;
}

/** A navy header row with white bold text. */
function writeHeaderRow(
  sheet: ExcelJS.Worksheet,
  row: number,
  headers: Array<{ label: string; kind: string }>,
): void {
  sheet.getRow(row).height = 21;
  headers.forEach((h, i) => {
    const cell = sheet.getCell(row, i + 1);
    cell.value = h.label;
    cell.font = { name: FONT, size: EXCEL_HEADER_SIZE, bold: true, color: { argb: WHITE } };
    cell.fill = solid(NAVY);
    cell.border = BORDER;
    cell.alignment = { horizontal: h.kind === 'text' ? 'left' : 'right', vertical: 'middle' };
  });
}

/** The holdings detail, as its own tab, ranked by market value. */
function writeHoldingsSheet(wb: ExcelJS.Workbook, asOf: PortfolioAsOf, currency: string): void {
  const sheet = wb.addWorksheet('Holdings', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true },
  });

  const headers: Array<{ label: string; width: number; kind: 'text' | 'number' | 'money' | 'percent' }> = [
    { label: 'Ticker', width: 16, kind: 'text' },
    { label: 'Sector', width: 22, kind: 'text' },
    { label: 'Quantity', width: 14, kind: 'number' },
    { label: 'Avg Cost', width: 14, kind: 'money' },
    { label: 'Close Price', width: 14, kind: 'money' },
    { label: 'Market Value', width: 18, kind: 'money' },
    { label: 'Cost Basis', width: 18, kind: 'money' },
    { label: 'Unrealized Gain', width: 18, kind: 'money' },
    { label: 'Weight', width: 12, kind: 'percent' },
  ];
  sheet.columns = headers.map((h) => ({ width: h.width }));

  writeTitleBar(sheet, headers.length, `HOLDINGS AS AT ${fmtLongDate(asOf.asOfDate).toUpperCase()}`);

  sheet.mergeCells(2, 1, 2, headers.length);
  const caption = sheet.getCell(2, 1);
  caption.value = amountsCaption(currency);
  caption.font = { name: FONT, size: EXCEL_BODY_SIZE, italic: true, color: { argb: MUTED } };
  caption.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(2).height = 18;

  writeHeaderRow(sheet, 3, headers);

  const positions = [...asOf.positions].sort((a, b) => b.marketValue - a.marketValue);

  positions.forEach((p, i) => {
    const r = 4 + i;
    const values: Array<number | string> = [
      p.ticker,
      p.sector || '—',
      p.quantity,
      p.averageCost,
      p.closingPrice,
      p.marketValue,
      p.costBasisTotal,
      p.unrealizedGain,
      p.weight,
    ];
    values.forEach((v, c) => {
      const cell = sheet.getCell(r, c + 1);
      cell.value = v;
      cell.fill = bandFill(bandOf(i));
      cell.border = BORDER;
      cell.alignment = { horizontal: c <= 1 ? 'left' : 'right', vertical: 'middle' };
      cell.font = { name: FONT, size: EXCEL_BODY_SIZE, bold: c === 0, color: { argb: INK } };
      const kind = headers[c].kind;
      if (typeof v === 'number') {
        if (kind === 'money') cell.numFmt = MONEY;
        else if (kind === 'percent') cell.numFmt = PERCENT_PLAIN;
        else if (kind === 'number') cell.numFmt = '#,##0.####';
      }
    });
  });

  const totalRow = 4 + positions.length;
  const totalFont: Partial<ExcelJS.Font> = { name: FONT, size: EXCEL_BODY_SIZE, bold: true, color: { argb: INK } };
  for (let c = 1; c <= headers.length; c += 1) {
    const cell = sheet.getCell(totalRow, c);
    cell.fill = solid(LIGHT_NAVY);
    cell.border = BORDER;
    cell.font = totalFont;
    cell.alignment = { horizontal: c === 1 ? 'left' : 'right', vertical: 'middle' };
  }
  sheet.getCell(totalRow, 1).value = 'TOTAL';

  // Per-share columns stay blank: a total of average costs across different
  // securities is not a quantity that means anything.
  const totals: Array<[number, number, string]> = [
    [6, asOf.holdingsValue, MONEY],
    [7, asOf.totalCost, MONEY],
    [8, asOf.unrealizedGain, MONEY],
    [9, positions.reduce((s, p) => s + p.weight, 0), PERCENT_PLAIN],
  ];
  totals.forEach(([col, value, fmt]) => {
    const cell = sheet.getCell(totalRow, col);
    cell.value = value;
    cell.numFmt = fmt;
  });
}

export async function downloadPeriodPerformanceWorkbook(
  clientName: string,
  pr: PeriodReturn,
  asOf: PortfolioAsOf | null,
  currency: string,
): Promise<void> {
  const wb = buildPeriodPerformanceWorkbook(clientName, pr, asOf, currency);
  // The window, not just the end date, is in the filename: two exports of the
  // same client taken on the same day for different periods must not collide.
  const slug = pr.label.replace(/[^\w]+/g, '-').toLowerCase();
  const name = clientName.replace(/\s+/g, '_').toLowerCase();
  await saveWorkbook(wb, `${name}-performance-${slug}-${pr.to.slice(0, 10)}.xlsx`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * The HOUSEHOLD statement — the same document with a family as its subject and
 * a per-account breakdown tab.
 * ──────────────────────────────────────────────────────────────────────────── */

export function familyLeftPanels(fr: FamilyPeriodReturn): Array<{ title: string; lines: Line[] }> {
  return [
    {
      title: 'HOUSEHOLD SUMMARY',
      lines: [
        { label: 'Accounts', value: fr.memberCount, kind: 'text', input: true },
        { label: 'Combined Opening Value', value: fr.openingValue, kind: 'money', input: true },
        { label: 'Net Flows', value: fr.netFlows, kind: 'money', input: true },
        { label: 'Combined Closing Value', value: fr.closingValue, kind: 'money', total: true },
        {
          label: 'Net Gain',
          value: fr.closingValue - fr.openingValue - fr.netFlows,
          kind: 'money',
          total: true,
        },
        { label: 'Period (Days)', value: fr.periodDays, kind: 'text', input: true },
      ],
    },
  ];
}

/**
 * One account's period return for the breakdown table.
 *
 * The engine solves an account funded mid-window from its first capital flow
 * (`capitalStartDate`), so `returnPct` is normally present. If a response
 * still arrives without it for an account that had no opening value but did
 * receive capital — an API build that predates that fix — the figure falls back
 * to Net Gain ÷ Net Flows, which is exactly the money-weighted return for a
 * single deposit and never prints "Not available" beside real cash flows.
 *
 * A late entrant stays unmeasured: its "flow" is its own closing balance,
 * imputed at entry, so any rate would be invented.
 */
export function memberReturn(m: FamilyMemberPerformance): number | null {
  if (m.returnPct !== null && m.returnPct !== undefined) return m.returnPct;
  if (!m.entryDate && m.openingValue === 0 && m.netFlows > 0) return m.gain / m.netFlows;
  return null;
}

export function buildFamilyPerformanceWorkbook(fr: FamilyPeriodReturn, currency: string): ExcelJS.Workbook {
  const wb = newWorkbook();
  const sheet = summarySheet(wb, 'Household Summary');

  writeBanner(sheet);
  writeIdentity(sheet, 'Household', fr.familyName, new Date(fr.to), familyTimeFrameLabel(fr));
  writeCaption(sheet, currency);

  const left = familyLeftPanels(fr);
  const right = familyRightLines(fr);

  writePanelHeader(sheet, PANEL_HEADER_ROW, 1, left[0].title);
  writePanelHeader(sheet, PANEL_HEADER_ROW, 4, 'PERFORMANCE METRICS');

  left[0].lines.forEach((line, i) => writeLine(sheet, FIRST_BODY_ROW + i, 1, line, bandOf(i)));
  right.forEach((line, i) => writeLine(sheet, FIRST_BODY_ROW + i, 4, line, bandOf(i)));

  const lastRow = FIRST_BODY_ROW + Math.max(left[0].lines.length, right.length);
  writeFooter(sheet, lastRow + 1, []);

  if (fr.members.length) writeMembersSheet(wb, fr, currency);
  return wb;
}

/** The per-account breakdown, as its own tab, closing on the household line. */
function writeMembersSheet(wb: ExcelJS.Workbook, fr: FamilyPeriodReturn, currency: string): void {
  const sheet = wb.addWorksheet('By Account', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 3 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true },
  });

  const headers: Array<{ label: string; width: number; kind: 'text' | 'money' | 'percent' | 'rate' }> = [
    { label: 'Account', width: 30, kind: 'text' },
    { label: 'Opening', width: 18, kind: 'money' },
    { label: 'Net Flows', width: 16, kind: 'money' },
    { label: 'Closing', width: 18, kind: 'money' },
    { label: 'Net Gain', width: 18, kind: 'money' },
    { label: 'Return', width: 14, kind: 'rate' },
    { label: 'Weight', width: 12, kind: 'percent' },
    { label: 'Note', width: 36, kind: 'text' },
  ];
  sheet.columns = headers.map((h) => ({ width: h.width }));

  writeTitleBar(sheet, headers.length, `ACCOUNTS IN ${fr.familyName.toUpperCase()}`);

  sheet.mergeCells(2, 1, 2, 4);
  const range = sheet.getCell(2, 1);
  range.value = familyTimeFrameLabel(fr);
  range.font = { name: FONT, size: EXCEL_BODY_SIZE, color: { argb: MUTED } };
  range.alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.mergeCells(2, 5, 2, headers.length);
  const caption = sheet.getCell(2, 5);
  caption.value = amountsCaption(currency);
  caption.font = { name: FONT, size: EXCEL_BODY_SIZE, italic: true, color: { argb: MUTED } };
  caption.alignment = { horizontal: 'right', vertical: 'middle' };
  sheet.getRow(2).height = 18;

  writeHeaderRow(sheet, 3, headers);

  const writeRow = (r: number, values: Array<number | string | null>, total: boolean, band: Band) => {
    sheet.getRow(r).height = 19;
    values.forEach((v, i) => {
      const cell = sheet.getCell(r, i + 1);
      const kind = headers[i].kind;
      cell.value = v === null ? NOT_AVAILABLE : v;
      cell.font = { name: FONT, size: EXCEL_BODY_SIZE, bold: total, color: { argb: INK } };
      cell.fill = total ? solid(LIGHT_NAVY) : bandFill(band);
      cell.border = BORDER;
      cell.alignment = { horizontal: kind === 'text' ? 'left' : 'right', vertical: 'middle' };
      if (typeof v === 'number') {
        if (kind === 'money') cell.numFmt = MONEY;
        if (kind === 'rate') cell.numFmt = PERCENT;
        if (kind === 'percent') cell.numFmt = PERCENT_PLAIN;
      }
    });
  };

  const members = [...fr.members].sort((a, b) => b.closingValue - a.closingValue);
  members.forEach((m, idx) => {
    const ret = memberReturn(m);
    writeRow(
      4 + idx,
      [
        m.clientName,
        m.openingValue,
        m.netFlows,
        m.closingValue,
        m.gain,
        ret,
        m.weight,
        m.entryDate ? `Joined ${fmtLongDate(m.entryDate)}` : ret === null ? m.returnReason ?? '' : '',
      ],
      false,
      bandOf(idx),
    );
  });

  writeRow(
    4 + members.length,
    [
      'HOUSEHOLD',
      fr.openingValue,
      fr.netFlows,
      fr.closingValue,
      fr.closingValue - fr.openingValue - fr.netFlows,
      fr.returnPct,
      1,
      '',
    ],
    true,
    'white',
  );
}

export async function downloadFamilyPerformanceWorkbook(fr: FamilyPeriodReturn, currency: string): Promise<void> {
  const wb = buildFamilyPerformanceWorkbook(fr, currency);
  const slug = fr.label.replace(/[^\w]+/g, '-').toLowerCase();
  const name = fr.familyName.replace(/\s+/g, '_').toLowerCase();
  await saveWorkbook(wb, `${name}-household-performance-${slug}-${fr.to.slice(0, 10)}.xlsx`);
}
