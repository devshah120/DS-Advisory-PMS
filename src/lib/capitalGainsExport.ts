import ExcelJS from 'exceljs';
import { CapitalGainsReport, RealizedGainRow } from '@/types/reports';

/**
 * The capital-gains workbook — the file a client forwards to their CA.
 *
 * Laid out to be RECONCILED, not merely read. Every figure a reader might
 * question is shown with the working beside it: per-share cost and proceeds sit
 * next to the totals they produce, and the acquisition date sits next to the
 * holding period it determines. A statement that shows only a net gain cannot
 * be checked against a contract note, and one that cannot be checked is one the
 * client's CA will not sign off.
 *
 * Four sheets, in the order a reader needs them:
 *   1. Summary        — the STCG/LTCG split that carries to the return
 *   2. Realized Gains — one row per lot depletion; ties line-by-line to a broker
 *   3. Unmatched      — sales with no defensible cost basis, shown not hidden
 *   4. Open Lots      — the unrealized side, with each lot's own clock running
 *
 * The figures are FIFO. See the API's analytics/calculators/tax-lots.ts for why
 * that is a filing requirement in both books rather than a preference.
 */

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2937' },
};
const LABEL_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3F4F6' },
};
const WARN_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFEF3C7' },
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
};

/**
 * Number formats per reporting currency.
 *
 * The rupee format uses Excel's INDIAN digit grouping (`#,##,##0.00`) rather
 * than the western one: an Indian client's statement reads ₹1,25,00,000, and a
 * western grouping on a document going to their CA is simply wrong. Mirrors
 * feeExport.ts, which established this for the fee statement.
 */
const CURRENCY_FORMATS: Record<string, string> = {
  USD: '"$"#,##0.00',
  INR: '"₹"#,##,##0.00',
  EUR: '"€"#,##0.00',
  GBP: '"£"#,##0.00',
};

/** Four decimals: a per-share cost on a sub-rupee stock rounds to nothing at two. */
const UNIT_FORMATS: Record<string, string> = {
  USD: '"$"#,##0.0000',
  INR: '"₹"#,##,##0.0000',
  EUR: '"€"#,##0.0000',
  GBP: '"£"#,##0.0000',
};

const moneyFormat = (currency: string) => CURRENCY_FORMATS[currency] ?? CURRENCY_FORMATS.USD;
const unitFormat = (currency: string) => UNIT_FORMATS[currency] ?? UNIT_FORMATS.USD;

/** ISO string → a date Excel treats as a date, not text. */
const toDate = (iso: string) => new Date(iso);

const DATE_FMT = 'dd-mmm-yyyy';

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: 'middle' };
  row.height = 20;
  row.eachCell((cell) => (cell.border = THIN_BORDER));
}

/**
 * The title block every sheet opens with.
 *
 * The period and the method are stated on the face of each sheet rather than
 * only on the summary, because these sheets get separated — a CA is sent the
 * detail tab alone often enough that an unlabelled one is a liability.
 */
function titleBlock(
  sheet: ExcelJS.Worksheet,
  report: CapitalGainsReport,
  subtitle: string,
  width: number,
): void {
  const title = sheet.addRow([`${report.clientName} — Capital Gains Statement`]);
  title.font = { bold: true, size: 14 };
  sheet.mergeCells(title.number, 1, title.number, width);

  const sub = sheet.addRow([subtitle]);
  sub.font = { size: 10, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(sub.number, 1, sub.number, width);

  const basis = sheet.addRow([
    'Cost basis: FIFO (first-in, first-out) — the method required for listed equity in this market.',
  ]);
  basis.font = { size: 9, italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(basis.number, 1, basis.number, width);

  sheet.addRow([]);
}

/**
 * The warning banner for imported acquisition dates.
 *
 * Placed at the TOP of the summary, not in a footnote. When lots carry
 * bulk-import dates rather than real ones, every one of them classifies as
 * short-term — taxing genuinely long-held positions at the higher rate. That
 * error runs against the client, so a reader must meet it before they meet the
 * numbers it affects.
 */
function warningBlock(sheet: ExcelJS.Worksheet, report: CapitalGainsReport, width: number): void {
  if (!report.hasSyntheticAcquisitionDates) return;

  const warn = sheet.addRow([
    'WARNING — This statement includes positions whose acquisition dates come from a bulk data import, ' +
      'not from actual contract notes. Their holding periods, and therefore the short-term / long-term ' +
      'split below, are UNRELIABLE and likely overstate short-term gains. Verify against contract notes ' +
      'before filing.',
  ]);
  warn.font = { bold: true, size: 10, color: { argb: 'FF92400E' } };
  warn.fill = WARN_FILL;
  warn.alignment = { wrapText: true, vertical: 'middle' };
  warn.height = 46;
  sheet.mergeCells(warn.number, 1, warn.number, width);
  warn.eachCell((cell) => (cell.border = THIN_BORDER));

  sheet.addRow([]);
}

function summarySheet(wb: ExcelJS.Workbook, report: CapitalGainsReport): void {
  const sheet = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
  const money = moneyFormat(report.currency);
  const s = report.summary;

  sheet.columns = [
    { width: 34 },
    { width: 18 },
    { width: 18 },
    { width: 18 },
  ];

  titleBlock(
    sheet,
    report,
    s
      ? `${s.label} · ${new Date(s.periodStart).toLocaleDateString('en-GB')} to ${new Date(
          s.periodEnd,
        ).toLocaleDateString('en-GB')}`
      : 'No realized activity',
    4,
  );

  warningBlock(sheet, report, 4);

  if (!s) {
    sheet.addRow(['No shares were sold in this period — there is nothing to report.']);
    return;
  }

  styleHeader(sheet.addRow(['', 'Short Term', 'Long Term', 'Total']));

  /**
   * Gains and losses on separate lines, with the net beneath.
   *
   * Not decoration: Indian s.74 set-off rules let a short-term loss offset
   * either term while a long-term loss offsets only long-term gains, so the
   * gross figures are what the working actually needs. A net-only statement
   * cannot be carried into that calculation.
   */
  const rows: Array<[string, number, number, number, boolean?]> = [
    ['Sale consideration (proceeds)', s.shortTerm.proceeds, s.longTerm.proceeds, s.total.proceeds],
    ['Cost of acquisition', s.shortTerm.costBasis, s.longTerm.costBasis, s.total.costBasis],
    ['Gross gains', s.shortTerm.gains, s.longTerm.gains, s.total.gains],
    ['Gross losses', -s.shortTerm.losses, -s.longTerm.losses, -s.total.losses],
    ['Net gain / (loss)', s.shortTerm.net, s.longTerm.net, s.total.net, true],
  ];

  for (const [label, st, lt, tot, bold] of rows) {
    const row = sheet.addRow([label, st, lt, tot]);
    row.getCell(1).fill = LABEL_FILL;
    row.font = { bold: Boolean(bold), size: 10 };
    for (let c = 2; c <= 4; c += 1) row.getCell(c).numFmt = money;
    row.eachCell((cell) => (cell.border = THIN_BORDER));
  }

  const count = sheet.addRow([
    'Number of transactions',
    s.shortTerm.transactions,
    s.longTerm.transactions,
    s.total.transactions,
  ]);
  count.getCell(1).fill = LABEL_FILL;
  count.font = { size: 10 };
  count.eachCell((cell) => (cell.border = THIN_BORDER));

  sheet.addRow([]);
  const note = sheet.addRow([
    'A "transaction" is one lot depletion, not one order: a sale spanning several purchase lots ' +
      'appears as several lines on the Realized Gains sheet, which is how a broker itemises it.',
  ]);
  note.font = { size: 9, italic: true, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(note.number, 1, note.number, 4);

  // Prior years, so the reader can see the trend without re-running the report.
  if (report.allYears.length > 1) {
    sheet.addRow([]);
    const h = sheet.addRow(['All Years']);
    h.font = { bold: true, size: 11 };

    styleHeader(sheet.addRow(['Period', 'Short Term', 'Long Term', 'Net']));
    for (const y of report.allYears) {
      const row = sheet.addRow([y.label, y.shortTerm.net, y.longTerm.net, y.total.net]);
      for (let c = 2; c <= 4; c += 1) row.getCell(c).numFmt = money;
      row.font = { size: 10 };
      row.eachCell((cell) => (cell.border = THIN_BORDER));
    }
  }
}

function realizedSheet(wb: ExcelJS.Workbook, report: CapitalGainsReport): void {
  const sheet = wb.addWorksheet('Realized Gains', { views: [{ showGridLines: false }] });
  const money = moneyFormat(report.currency);
  const unit = unitFormat(report.currency);
  const rows: RealizedGainRow[] = report.summary?.rows ?? [];

  sheet.columns = [
    { width: 14 }, // ticker
    { width: 10 }, // qty
    { width: 13 }, // acquired
    { width: 13 }, // sold
    { width: 9 }, //  days
    { width: 10 }, // term
    { width: 14 }, // cost/sh
    { width: 14 }, // proceeds/sh
    { width: 15 }, // cost basis
    { width: 15 }, // proceeds
    { width: 15 }, // gain
    { width: 22 }, // notes
  ];

  titleBlock(sheet, report, `${report.summary?.label ?? ''} · one row per tax lot sold`, 12);

  styleHeader(
    sheet.addRow([
      'Security',
      'Qty',
      'Acquired',
      'Sold',
      'Days',
      'Term',
      'Cost / Share',
      'Proceeds / Share',
      'Cost of Acquisition',
      'Sale Consideration',
      'Gain / (Loss)',
      'Notes',
    ]),
  );

  if (rows.length === 0) {
    sheet.addRow(['No shares were sold in this period.']);
    return;
  }

  for (const r of rows) {
    /**
     * Notes carry the two facts that change how a line should be read: a
     * zero-cost bonus lot (where the whole proceeds are gain) and a
     * grandfathered basis (where the cost shown is a substituted 31-Jan-2018
     * value, not what was paid). Both would otherwise look like errors.
     */
    const notes: string[] = [];
    if (r.fromBonus) notes.push('Bonus issue — nil cost');
    if (r.grandfathered) {
      notes.push(`s.112A: actual cost ${r.originalCostPerShare.toFixed(2)}`);
    }

    const row = sheet.addRow([
      r.ticker,
      r.quantity,
      toDate(r.acquiredOn),
      toDate(r.soldOn),
      r.holdingDays,
      r.term === 'LONG' ? 'Long' : 'Short',
      r.costPerShare,
      r.proceedsPerShare,
      r.costBasis,
      r.proceeds,
      r.gain,
      notes.join('; '),
    ]);

    row.font = { size: 10 };
    row.getCell(3).numFmt = DATE_FMT;
    row.getCell(4).numFmt = DATE_FMT;
    row.getCell(7).numFmt = unit;
    row.getCell(8).numFmt = unit;
    row.getCell(9).numFmt = money;
    row.getCell(10).numFmt = money;
    row.getCell(11).numFmt = money;
    // A loss reads red, the way every broker statement renders one.
    row.getCell(11).font = {
      size: 10,
      bold: true,
      color: { argb: r.gain < 0 ? 'FFB91C1C' : 'FF065F46' },
    };
    row.getCell(12).font = { size: 9, italic: true, color: { argb: 'FF6B7280' } };
    row.eachCell((cell) => (cell.border = THIN_BORDER));
  }

  const s = report.summary;
  if (s) {
    const total = sheet.addRow([
      'Total',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      s.total.costBasis,
      s.total.proceeds,
      s.total.net,
      '',
    ]);
    total.font = { bold: true, size: 10 };
    total.getCell(9).numFmt = money;
    total.getCell(10).numFmt = money;
    total.getCell(11).numFmt = money;
    total.eachCell((cell) => {
      cell.border = THIN_BORDER;
      cell.fill = LABEL_FILL;
    });
  }

  // Freeze the header so the columns stay identified while scrolling a long year.
  sheet.views = [{ state: 'frozen', ySplit: sheet.rowCount - rows.length - 1, showGridLines: false }];
}

/**
 * Sales with no matching purchase.
 *
 * Given its own sheet rather than a footnote. These are proceeds we cannot
 * assign a cost to, so they are NOT in the gain totals — a reader who does not
 * know that would reconcile the statement against the broker's proceeds figure
 * and find a gap with no explanation.
 */
function unmatchedSheet(wb: ExcelJS.Workbook, report: CapitalGainsReport): void {
  if (report.unmatchedSales.length === 0) return;

  const sheet = wb.addWorksheet('Unmatched Sales', { views: [{ showGridLines: false }] });
  const money = moneyFormat(report.currency);

  sheet.columns = [{ width: 16 }, { width: 12 }, { width: 14 }, { width: 18 }];

  titleBlock(sheet, report, 'Sales with no recorded purchase', 4);

  const explain = sheet.addRow([
    'These sales could not be matched to any purchase in the ledger, so no cost basis can be ' +
      'defended for them. They are EXCLUDED from the gain figures on the other sheets. Supply the ' +
      'original contract notes to complete the record.',
  ]);
  explain.font = { size: 10, color: { argb: 'FF92400E' } };
  explain.fill = WARN_FILL;
  explain.alignment = { wrapText: true, vertical: 'middle' };
  explain.height = 34;
  sheet.mergeCells(explain.number, 1, explain.number, 4);
  sheet.addRow([]);

  styleHeader(sheet.addRow(['Security', 'Qty', 'Sold', 'Sale Consideration']));

  for (const u of report.unmatchedSales) {
    const row = sheet.addRow([u.ticker, u.quantity, toDate(u.date), u.proceeds]);
    row.font = { size: 10 };
    row.getCell(3).numFmt = DATE_FMT;
    row.getCell(4).numFmt = money;
    row.eachCell((cell) => (cell.border = THIN_BORDER));
  }
}

/**
 * Still-open lots — the unrealized side.
 *
 * Included because the next question after "what did I realize" is always "what
 * happens if I sell the rest", and that answer depends on each lot's own clock.
 * The days-held column is what tells a client a parcel is three weeks short of
 * long-term treatment.
 */
function openLotsSheet(wb: ExcelJS.Workbook, report: CapitalGainsReport): void {
  if (report.openLots.length === 0) return;

  const sheet = wb.addWorksheet('Open Lots', { views: [{ showGridLines: false }] });
  const money = moneyFormat(report.currency);
  const unit = unitFormat(report.currency);

  sheet.columns = [
    { width: 16 },
    { width: 12 },
    { width: 14 },
    { width: 13 },
    { width: 10 },
    { width: 16 },
    { width: 20 },
  ];

  titleBlock(sheet, report, 'Unsold lots, oldest first — these deplete next under FIFO', 7);

  styleHeader(
    sheet.addRow(['Security', 'Qty', 'Cost / Share', 'Acquired', 'Days Held', 'Cost of Acquisition', 'Notes']),
  );

  const now = Date.now();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  for (const lot of report.openLots) {
    const days = Math.floor((now - new Date(lot.acquiredOn).getTime()) / MS_PER_DAY);
    const notes: string[] = [];
    if (lot.fromBonus) notes.push('Bonus issue — nil cost');
    // 365 is the long-term boundary in both books; flag the near-misses, since
    // that is actionable information and the reason to show days at all.
    if (days <= 365 && days > 335) notes.push(`Long-term in ${366 - days} days`);

    const row = sheet.addRow([
      lot.ticker,
      lot.quantity,
      lot.unitCost,
      toDate(lot.acquiredOn),
      days,
      lot.unitCost * lot.quantity,
      notes.join('; '),
    ]);
    row.font = { size: 10 };
    row.getCell(3).numFmt = unit;
    row.getCell(4).numFmt = DATE_FMT;
    row.getCell(6).numFmt = money;
    row.getCell(7).font = { size: 9, italic: true, color: { argb: 'FF6B7280' } };
    row.eachCell((cell) => (cell.border = THIN_BORDER));
  }
}

export async function buildCapitalGainsWorkbook(
  report: CapitalGainsReport,
): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Giriraj Global Capital';
  wb.created = new Date();

  summarySheet(wb, report);
  realizedSheet(wb, report);
  unmatchedSheet(wb, report);
  openLotsSheet(wb, report);

  return wb;
}

export async function downloadCapitalGainsWorkbook(report: CapitalGainsReport): Promise<void> {
  const wb = await buildCapitalGainsWorkbook(report);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  const name = report.clientName.replace(/\s+/g, '_').toLowerCase();
  const period = report.summary?.label ?? 'all';
  link.download = `capital-gains-${name}-${period.toLowerCase()}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
