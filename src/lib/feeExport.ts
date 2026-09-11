import ExcelJS from 'exceljs';
import {
  ClientFeeRow,
  FamilyFeeInvoice,
  feeSegments,
  proratedTrancheCount,
} from '@/types/reports';
import { formatDate } from './utils';

const LABEL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };

/**
 * Where the OPENING book came from — the base the fee prorates forward from.
 * ('live' is retained for fee rows frozen before proration shipped, which
 * valued an open quarter on live holdings.)
 */
const VALUATION_SOURCE_LABEL: Record<string, string> = {
  snapshot: 'Opening snapshot (recorded on the day)',
  reconstruction: 'Reconstructed from baseline + transactions',
  live: 'Live holdings (quarter still open)',
  unavailable: 'Unavailable — no baseline to value from',
};
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
};

/**
 * Excel number formats and locales, per reporting currency.
 *
 * The rupee format uses Excel's Indian digit grouping (`#,##,##0.00`), not the
 * western one — an Indian client's statement reads ₹1,25,00,000, and a western
 * grouping in a fee document sent to them is simply wrong. `₹` is written
 * as an escape so the format string survives any file-encoding round trip.
 */
const CURRENCY_FORMATS: Record<string, { numFmt: string; locale: string }> = {
  USD: { numFmt: '"$"#,##0.00', locale: 'en-US' },
  INR: { numFmt: '"₹"#,##,##0.00', locale: 'en-IN' },
  EUR: { numFmt: '"€"#,##0.00', locale: 'de-DE' },
  GBP: { numFmt: '"£"#,##0.00', locale: 'en-GB' },
};

function currencyFormat(currency: string | undefined) {
  return CURRENCY_FORMATS[currency ?? 'USD'] ?? CURRENCY_FORMATS.USD;
}

/**
 * The day-count to show for one account.
 *
 * `daysBilled` describes the OPENING book only. Once capital has been deployed
 * mid-quarter, each tranche carries its own day-count, and printing the
 * opening figure alone would state that the whole fee was billed over those
 * days — the precise misreading this proration exists to correct. So an
 * account with flows is marked as having several, and the Account Detail tab
 * carries the breakdown.
 */
function daysBilledLabel(line: ClientFeeRow): string {
  const flows = proratedTrancheCount(line);
  const base = `${line.daysBilled} / ${line.daysInQuarter}`;
  return flows > 0 ? `${base} +${flows} tranche${flows === 1 ? '' : 's'}` : base;
}

/**
 * The proration the account was ACTUALLY charged at, back-solved from the fee.
 *
 * Not days ÷ days-in-quarter: with capital deployed mid-quarter the fee is a
 * sum over tranches with different day-counts, and no single ratio of days
 * produces it. Dividing the billed fee by what a full quarter on the same
 * capital would have cost gives the one number that reconciles.
 */
function effectiveProration(line: ClientFeeRow): number | string {
  const fullQuarter = line.portfolioValue * (line.feeRatePercent / 100 / 4);
  if (fullQuarter <= 0) return '';
  return line.feeAmount / fullQuarter;
}

/**
 * One client's fee statement: a summary page, plus the working on its own sheet.
 *
 * The summary is a bordered label/value box — the same shape as the firm's
 * reference workbook — answering "what do I owe". The arithmetic that justifies
 * it lives on 'Fee Calculation', because a client who accepts the number should
 * not have to read a page of machinery to reach it, and a client who queries it
 * needs more than the summary could ever hold.
 */
export async function buildClientFeeWorkbook(fee: ClientFeeRow): Promise<ExcelJS.Workbook> {
  // The unit this mandate is billed in — an Indian client's statement is in
  // rupees, with Indian digit grouping, not dollars.
  const money = currencyFormat(fee.currency);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Giriraj Global Consultants';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Fee Schedule', {
    views: [{ showGridLines: false }],
  });
  sheet.columns = [{ width: 34 }, { width: 22 }];

  const title = sheet.addRow([`Fee Schedule — ${fee.clientName}`]);
  title.font = { bold: true, size: 14 };
  sheet.mergeCells(title.number, 1, title.number, 2);

  const subtitle = sheet.addRow([
    `${fee.quarterLabel} · ${formatDate(fee.quarterStart)} to ${formatDate(fee.quarterEnd)}`,
  ]);
  subtitle.font = { size: 10, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(subtitle.number, 1, subtitle.number, 2);

  sheet.addRow([]);

  // A closed quarter's figures are locked; an open one runs to today.
  // Labelling the row tells the reader which they are looking at, so an
  // estimate is never mistaken for an invoice.
  const valueLabel = fee.isEstimate
    ? 'Billable capital (quarter in progress)'
    : 'Billable capital';

  const rows: Array<[string, string | number, string?]> = [
    ['Annual fee rate', fee.feeRatePercent / 100, '0.00%'],
    ['Quarterly rate (annual ÷ 4)', fee.feeRatePercent / 100 / 4, '0.0000%'],
  ];

  /**
   * The opening book, only when there was one.
   *
   * Loose != catches both null (a pre-proration frozen row) and undefined (an
   * API deployed before the field existed). Zero is excluded too: a mandate
   * that began mid-quarter opened with nothing, and printing "Opening book ₹0"
   * reads as a missing figure rather than as an accurate one.
   */
  if (fee.openingValue != null && fee.openingValue !== 0) {
    rows.push(['Opening book (start of quarter)', fee.openingValue, money.numFmt]);
  }

  rows.push([valueLabel, fee.portfolioValue, money.numFmt]);

  /**
   * The day-count line, only when a single number can honestly describe the
   * fee — i.e. when nothing was invested mid-quarter.
   *
   * With tranches, `daysBilled` covers the opening book alone, and putting it
   * on the summary beside the total is precisely the misreading this whole
   * change exists to prevent: it invites "so my new money was charged 72 days
   * too". The per-tranche day-counts are on the working sheet, where each sits
   * next to the capital it actually applies to.
   */
  if (proratedTrancheCount(fee) === 0) {
    rows.push(['Days billed', `${fee.daysBilled} / ${fee.daysInQuarter}`]);
  }

  for (const [label, value, format] of rows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).fill = LABEL_FILL;
    row.getCell(1).font = { bold: true, size: 10 };
    row.getCell(2).alignment = { horizontal: 'right' };
    if (format) row.getCell(2).numFmt = format;
    row.getCell(1).border = THIN_BORDER;
    row.getCell(2).border = THIN_BORDER;
  }

  const totalRow = sheet.addRow(['Fee amount', fee.feeAmount]);
  totalRow.getCell(1).fill = LABEL_FILL;
  totalRow.getCell(1).font = { bold: true, size: 11 };
  totalRow.getCell(2).font = { bold: true, size: 11 };
  totalRow.getCell(2).numFmt = money.numFmt;
  totalRow.getCell(2).alignment = { horizontal: 'right' };
  totalRow.getCell(1).border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF111827' } } };
  totalRow.getCell(2).border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF111827' } } };

  // Status stays on the summary — whether this is a bill or an estimate
  // changes what the reader should DO with the total, so it belongs next to
  // it. The valuation provenance moves to the working sheet: it matters to
  // whoever audits the fee, not to whoever pays it.
  sheet.addRow([]);
  const statusRow = sheet.addRow([
    'Status',
    fee.isEstimate ? 'Estimate (quarter in progress)' : 'Final — billed',
  ]);
  statusRow.getCell(1).font = { size: 9, color: { argb: 'FF6B7280' } };
  statusRow.getCell(2).font = { size: 9, color: { argb: 'FF6B7280' } };

  /**
   * The one line of method that belongs on the front page.
   *
   * A client who added money late in the quarter looks at the summary first,
   * and the question in their head is "was my new money charged for the whole
   * quarter?". Answering it here — in one sentence, pointing at the sheet that
   * proves it — is what stops the total being disputed before the working is
   * ever opened. Everything else lives on 'Fee Calculation'.
   */
  if (proratedTrancheCount(fee) > 0) {
    sheet.addRow([]);
    const note = sheet.addRow([
      'Capital added during the quarter is charged only for the days it was invested, ' +
        'not for the full quarter. See the Fee Calculation sheet for the full working.',
    ]);
    note.font = { size: 9, italic: true, color: { argb: 'FF6B7280' } };
    note.alignment = { wrapText: true, vertical: 'top' };
    sheet.mergeCells(note.number, 1, note.number, 2);
    sheet.getRow(note.number).height = 28;
  }

  writeClientWorkingSheet(wb, fee, money);

  return wb;
}

/**
 * The full working, on its own sheet.
 *
 * Kept off the summary deliberately: the front page answers "what do I owe",
 * and a client who accepts the number should not have to read a page of
 * arithmetic to reach it. This sheet answers "how was that worked out" for the
 * client who does ask — and it is written to be read by the CLIENT, not only
 * by whoever audits it, because the dispute it prevents is the client
 * believing a late deposit was charged for the whole quarter.
 */
function writeClientWorkingSheet(
  wb: ExcelJS.Workbook,
  fee: ClientFeeRow,
  money: { numFmt: string; locale: string },
): void {
  const sheet = wb.addWorksheet('Fee Calculation', { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 30 }, // What was billed
    { width: 18 }, // Capital
    { width: 14 }, // Days
    { width: 13 }, // Quarterly rate
    { width: 16 }, // Fee
    { width: 46 }, // Calculation
  ];

  const title = sheet.addRow([`How this fee was calculated — ${fee.clientName}`]);
  title.font = { bold: true, size: 13 };
  sheet.mergeCells(title.number, 1, title.number, 6);

  const subtitle = sheet.addRow([
    `${fee.quarterLabel} · ${formatDate(fee.quarterStart)} to ${formatDate(fee.quarterEnd)} · ` +
      `${fee.daysInQuarter} days in the quarter`,
  ]);
  subtitle.font = { size: 10, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(subtitle.number, 1, subtitle.number, 6);

  sheet.addRow([]);

  // Absent on a row billed under the old single-NAV basis, which then falls
  // through to the single-line working below.
  const segments = feeSegments(fee);

  /**
   * The method in plain words, before any numbers.
   *
   * This is the paragraph the client actually reads. It states the rule that
   * governs their money — charged from the day it is invested — rather than
   * describing the formula, because a client disputing a fee is disputing the
   * rule, not the arithmetic.
   */
  const methodTitle = sheet.addRow(['Method']);
  methodTitle.font = { bold: true, size: 11 };

  const methodLines =
    segments.length > 0
      ? [
          'Your management fee is charged at the annual rate shown, divided by four for the quarter.',
          'Capital is charged only for the days it was actually invested. Money invested at the start ' +
            'of the quarter is charged for the full quarter; money invested part-way through is charged ' +
            'only from that date to the end of the quarter.',
          'Each line below is one tranche of capital, with the exact number of days it was charged for. ' +
            'The fee is the sum of those lines.',
        ]
      : [
          'Your management fee is charged at the annual rate shown, divided by four for the quarter, ' +
            'and prorated for the days your mandate was active.',
        ];

  for (const text of methodLines) {
    const row = sheet.addRow([text]);
    row.font = { size: 10 };
    row.alignment = { wrapText: true, vertical: 'top' };
    sheet.mergeCells(row.number, 1, row.number, 6);
    sheet.getRow(row.number).height = 28;
  }

  sheet.addRow([]);

  if (segments.length > 0) {
    const header = sheet.addRow([
      'What was billed',
      'Capital',
      'Days charged',
      'Quarterly rate',
      'Fee',
      'Calculation',
    ]);
    header.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell, col) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: col === 1 || col === 6 ? 'left' : 'right' };
    });

    const asMoney = (n: number) =>
      n.toLocaleString(money.locale, {
        style: 'currency',
        currency: fee.currency ?? 'USD',
      });

    segments.forEach((seg, i) => {
      /**
       * The label carries the WHY, not just the date. "Invested 11 Sep 2026"
       * is what a client recognises as their own deposit; "flow" is not.
       */
      const label =
        seg.kind === 'opening'
          ? `Held from ${formatDate(seg.from)} (start of quarter)`
          : seg.amount >= 0
            ? `Invested ${formatDate(seg.from)}`
            : `Withdrawn ${formatDate(seg.from)}`;

      const row = sheet.addRow([
        label,
        seg.amount,
        `${seg.days} of ${fee.daysInQuarter}`,
        fee.feeRatePercent / 100 / 4,
        seg.fee,
        `${asMoney(seg.amount)} × ${(fee.feeRatePercent / 4).toFixed(4)}% × ` +
          `(${seg.days} ÷ ${fee.daysInQuarter})`,
      ]);

      row.getCell(2).numFmt = money.numFmt;
      row.getCell(4).numFmt = '0.0000%';
      row.getCell(5).numFmt = money.numFmt;
      row.getCell(6).font = { size: 9, color: { argb: 'FF6B7280' } };
      row.eachCell((cell, col) => {
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: col === 1 || col === 6 ? 'left' : 'right' };
        if (i % 2 === 0) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        }
      });
    });

    const total = sheet.addRow([
      'Total fee',
      fee.portfolioValue,
      '',
      '',
      fee.feeAmount,
      '',
    ]);
    total.font = { bold: true, size: 11 };
    total.getCell(2).numFmt = money.numFmt;
    total.getCell(5).numFmt = money.numFmt;
    total.eachCell((cell, col) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      cell.border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF111827' } } };
      cell.alignment = { horizontal: col === 1 || col === 6 ? 'left' : 'right' };
    });

    /**
     * The worked comparison — the single most useful thing on the sheet.
     *
     * A client who added money late in the quarter wants to know what they
     * were SAVED, not only what they were charged. Stating both numbers side
     * by side turns the proration from a claim into something they can check.
     */
    const lateTranches = segments.filter((s) => s.kind === 'flow' && s.amount > 0);
    if (lateTranches.length > 0) {
      sheet.addRow([]);
      const compareTitle = sheet.addRow(['Effect of charging by days invested']);
      compareTitle.font = { bold: true, size: 11 };

      for (const seg of lateTranches) {
        const fullQuarter = seg.amount * (fee.feeRatePercent / 100 / 4);
        const row = sheet.addRow([
          `Capital invested ${formatDate(seg.from)}`,
          seg.amount,
          `${seg.days} of ${fee.daysInQuarter}`,
          '',
          seg.fee,
          `Charged ${asMoney(seg.fee)} for ${seg.days} day${seg.days === 1 ? '' : 's'} ` +
            `instead of ${asMoney(fullQuarter)} for the full quarter`,
        ]);
        row.getCell(2).numFmt = money.numFmt;
        row.getCell(5).numFmt = money.numFmt;
        row.getCell(6).font = { size: 9, italic: true, color: { argb: 'FF047857' } };
        row.eachCell((cell, col) => {
          cell.border = THIN_BORDER;
          cell.alignment = { horizontal: col === 1 || col === 6 ? 'left' : 'right' };
        });
      }
    }
  } else {
    // A row billed before segmented proration shipped: one capital figure,
    // one day-count. Shown as it was billed rather than dressed up as a
    // breakdown that never existed.
    const header = sheet.addRow([
      'What was billed',
      'Portfolio value',
      'Days charged',
      'Quarterly rate',
      'Fee',
      'Calculation',
    ]);
    header.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    header.eachCell((cell, col) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: col === 1 || col === 6 ? 'left' : 'right' };
    });

    const row = sheet.addRow([
      'Quarter fee',
      fee.portfolioValue,
      `${fee.daysBilled} of ${fee.daysInQuarter}`,
      fee.feeRatePercent / 100 / 4,
      fee.feeAmount,
      `${fee.portfolioValue.toLocaleString(money.locale, {
        style: 'currency',
        currency: fee.currency ?? 'USD',
      })} × ${(fee.feeRatePercent / 4).toFixed(4)}% × (${fee.daysBilled} ÷ ${fee.daysInQuarter})`,
    ]);
    row.getCell(2).numFmt = money.numFmt;
    row.getCell(4).numFmt = '0.0000%';
    row.getCell(5).numFmt = money.numFmt;
    row.getCell(6).font = { size: 9, color: { argb: 'FF6B7280' } };
    row.eachCell((cell, col) => {
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: col === 1 || col === 6 ? 'left' : 'right' };
    });
  }

  // --- provenance, for whoever audits rather than reads --------------------
  sheet.addRow([]);
  const statusRow = sheet.addRow([
    'Status',
    fee.isEstimate
      ? 'Estimate — this quarter has not closed. Days charged increase until the quarter ends.'
      : 'Final — billed',
  ]);
  statusRow.getCell(1).font = { size: 9, bold: true, color: { argb: 'FF6B7280' } };
  statusRow.getCell(2).font = { size: 9, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(statusRow.number, 2, statusRow.number, 6);

  const sourceRow = sheet.addRow([
    'Valuation source',
    VALUATION_SOURCE_LABEL[fee.valuationSource] ?? fee.valuationSource,
  ]);
  sourceRow.getCell(1).font = { size: 9, bold: true, color: { argb: 'FF6B7280' } };
  sourceRow.getCell(2).font = { size: 9, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(sourceRow.number, 2, sourceRow.number, 6);
}

export async function downloadClientFeeWorkbook(fee: ClientFeeRow): Promise<void> {
  const wb = await buildClientFeeWorkbook(fee);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `fee-schedule-${fee.clientName.replace(/\s+/g, '_').toLowerCase()}-${fee.quarterLabel.replace(/\s+/g, '_').toLowerCase()}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * The HOUSEHOLD invoice — one bill for the family, itemised by account.
 *
 * Laid out as an invoice rather than as the label/value working box a single
 * client's fee uses, because it is a different document for a different
 * purpose: this one gets sent to the family, and the question it must answer
 * on sight is "what do we owe, and how was each account charged".
 *
 * Every line carries the full working — portfolio value, annual rate, days
 * billed, and the resulting fee — so the family can check the arithmetic
 * without a second document. The figures are the members' own fee rows
 * unchanged, so a line here and that member's individual statement always
 * agree.
 */
export async function buildFamilyInvoiceWorkbook(
  invoice: FamilyFeeInvoice,
): Promise<ExcelJS.Workbook> {
  const money = currencyFormat(invoice.currency);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Giriraj Global Consultants';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Invoice', { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 32 }, // Account
    { width: 20 }, // Portfolio value
    { width: 13 }, // Annual rate
    { width: 14 }, // Days billed
    { width: 13 }, // Proration
    { width: 18 }, // Fee
  ];

  const title = sheet.addRow([`Fee Invoice — ${invoice.familyName}`]);
  title.font = { bold: true, size: 14 };
  sheet.mergeCells(title.number, 1, title.number, 6);

  const subtitle = sheet.addRow([
    `${invoice.quarterLabel} · ${formatDate(invoice.quarterStart)} to ${formatDate(invoice.quarterEnd)}` +
      ` · ${invoice.totals.billedCount} of ${invoice.totals.memberCount} accounts billed`,
  ]);
  subtitle.font = { size: 10, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(subtitle.number, 1, subtitle.number, 6);

  /**
   * An open quarter is an estimate, and the invoice says so at the top rather
   * than in a footnote. A household bill mistaken for a final one gets paid,
   * and unwinding that is worse than a line of text here.
   */
  if (invoice.isEstimate) {
    const banner = sheet.addRow([
      'ESTIMATE — this quarter has not closed. Figures are based on live portfolio values and will change.',
    ]);
    banner.font = { bold: true, size: 10, color: { argb: 'FF92400E' } };
    banner.getCell(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFEF3C7' },
    };
    sheet.mergeCells(banner.number, 1, banner.number, 6);
  }

  sheet.addRow([]);

  // --- line items, one per member account -----------------------------------
  const header = sheet.addRow([
    'Account',
    invoice.isEstimate ? 'Billable capital (to date)' : 'Billable capital',
    'Annual rate',
    'Days billed',
    'Effective proration',
    'Fee',
  ]);
  header.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle' };
  });
  header.getCell(1).alignment = { horizontal: 'left', vertical: 'middle' };
  for (let c = 2; c <= 6; c++) {
    header.getCell(c).alignment = { horizontal: 'right', vertical: 'middle' };
  }

  invoice.lines.forEach((line, i) => {
    const row = sheet.addRow([
      line.clientName,
      line.portfolioValue,
      line.feeRatePercent / 100,
      daysBilledLabel(line),
      effectiveProration(line),
      line.feeAmount,
    ]);

    row.getCell(2).numFmt = money.numFmt;
    row.getCell(3).numFmt = '0.00%';
    row.getCell(5).numFmt = '0.00%';
    row.getCell(6).numFmt = money.numFmt;
    row.getCell(6).font = { bold: true };

    row.eachCell((cell, col) => {
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: col === 1 ? 'left' : 'right' };
      if (i % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
      }
    });
  });

  // --- the total ------------------------------------------------------------
  const total = sheet.addRow([
    'Total due',
    invoice.totals.portfolioValue,
    invoice.totals.effectiveAnnualRatePercent !== null
      ? invoice.totals.effectiveAnnualRatePercent / 100
      : '',
    '',
    '',
    invoice.totals.feeAmount,
  ]);
  total.font = { bold: true, size: 11 };
  total.getCell(2).numFmt = money.numFmt;
  if (invoice.totals.effectiveAnnualRatePercent !== null) total.getCell(3).numFmt = '0.00%';
  total.getCell(6).numFmt = money.numFmt;
  total.eachCell((cell, col) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    cell.border = {
      ...THIN_BORDER,
      top: { style: 'medium', color: { argb: 'FF111827' } },
    };
    cell.alignment = { horizontal: col === 1 ? 'left' : 'right' };
  });

  // The rate column on the total line is an EFFECTIVE rate, not a rate anyone
  // was charged — saying so stops it being quoted back as the household's rate.
  if (invoice.totals.effectiveAnnualRatePercent !== null) {
    const note = sheet.addRow([
      '',
      '',
      'effective',
      '',
      '',
      '',
    ]);
    note.getCell(3).font = { size: 8, italic: true, color: { argb: 'FF6B7280' } };
    note.getCell(3).alignment = { horizontal: 'right' };
  }

  // --- accounts not billed --------------------------------------------------
  /**
   * Listed on the invoice itself, not omitted.
   *
   * A household bill that silently drops an account still reads as a complete
   * bill for the family, and the client is the party least able to notice. Any
   * excluded member is named with the reason.
   */
  if (invoice.unbilled.length > 0) {
    sheet.addRow([]);
    const heading = sheet.addRow(['Accounts not billed this quarter']);
    heading.font = { bold: true, size: 10 };
    sheet.mergeCells(heading.number, 1, heading.number, 6);

    for (const u of invoice.unbilled) {
      const row = sheet.addRow([u.clientName, u.reason]);
      row.getCell(1).font = { size: 10 };
      row.getCell(2).font = { size: 10, color: { argb: 'FF6B7280' } };
      sheet.mergeCells(row.number, 2, row.number, 6);
    }
  }

  /**
   * One line of method, pointing at the sheet that proves it — the same
   * treatment as the single-client statement. The arithmetic itself lives on
   * Account Detail so this page stays a bill.
   */
  sheet.addRow([]);
  const summed = sheet.addRow([
    invoice.lines.some((l) => proratedTrancheCount(l) > 0)
      ? 'Each account is billed at its own rate, and capital added during the quarter is charged ' +
        'only for the days it was invested — not for the full quarter. See the Account Detail ' +
        'sheet for the working behind every line.'
      : 'Each account is billed at its own rate and prorated by its own inception date. ' +
        'See the Account Detail sheet for the working behind every line.',
  ]);
  summed.font = { size: 10, color: { argb: 'FF6B7280' } };
  summed.alignment = { wrapText: true, vertical: 'top' };
  sheet.mergeCells(summed.number, 1, summed.number, 6);
  sheet.getRow(summed.number).height = 30;

  const statusRow = sheet.addRow([
    'Status',
    invoice.isEstimate ? 'Estimate (quarter in progress)' : 'Final — billed',
  ]);
  statusRow.getCell(1).font = { size: 9, color: { argb: 'FF6B7280' } };
  statusRow.getCell(2).font = { size: 9, color: { argb: 'FF6B7280' } };

  // --- per-account detail tab ----------------------------------------------
  writeAccountDetailSheet(wb, invoice, money);

  return wb;
}

/**
 * The full per-account working, as its own tab.
 *
 * The Invoice sheet is what the family reads; this is what someone auditing it
 * reads. Keeping the method, the valuation provenance and the tranche-level
 * arithmetic off the main sheet stops a six-line bill turning into a page of
 * machinery — while still putting the full working one click away, which is
 * what a family querying a late deposit actually needs.
 */
function writeAccountDetailSheet(
  wb: ExcelJS.Workbook,
  invoice: FamilyFeeInvoice,
  money: { numFmt: string; locale: string },
): void {
  const sheet = wb.addWorksheet('Account Detail', { views: [{ showGridLines: false }] });
  sheet.columns = [
    { width: 32 },
    { width: 20 },
    { width: 13 },
    { width: 14 },
    { width: 13 },
    { width: 18 },
    { width: 40 },
    { width: 34 },
  ];

  const title = sheet.addRow([
    `How these fees were calculated — ${invoice.familyName}, ${invoice.quarterLabel}`,
  ]);
  title.font = { bold: true, size: 12 };
  sheet.mergeCells(title.number, 1, title.number, 8);
  sheet.addRow([]);

  /**
   * The method, stated before the numbers — this sheet has to stand on its own
   * for a family member who opens it without reading the invoice page first.
   */
  const methodTitle = sheet.addRow(['Method']);
  methodTitle.font = { bold: true, size: 11 };

  for (const text of [
    'Each account is charged at its own annual rate, divided by four for the quarter.',
    'Capital is charged only for the days it was actually invested. Money held from the start of ' +
      'the quarter is charged for the full quarter; money invested part-way through is charged ' +
      'only from that date to the end of the quarter.',
    'Indented rows below each account are the individual tranches of capital, with the exact ' +
      'number of days each was charged for. An account’s fee is the sum of its tranches.',
  ]) {
    const row = sheet.addRow([text]);
    row.font = { size: 10 };
    row.alignment = { wrapText: true, vertical: 'top' };
    sheet.mergeCells(row.number, 1, row.number, 8);
    sheet.getRow(row.number).height = 24;
  }

  sheet.addRow([]);

  const header = sheet.addRow([
    'Account',
    'Capital',
    'Annual rate',
    'Days at work',
    'Proration',
    'Fee',
    'Calculation',
    'Valuation source',
  ]);
  header.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  header.eachCell((cell, col) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111827' } };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: col === 1 || col >= 7 ? 'left' : 'right' };
  });

  const asMoney = (n: number) =>
    n.toLocaleString(money.locale, {
      style: 'currency',
      currency: invoice.currency ?? 'USD',
    });

  for (const line of invoice.lines) {
    const lineSegments = feeSegments(line);
    const row = sheet.addRow([
      line.clientName,
      line.portfolioValue,
      line.feeRatePercent / 100,
      daysBilledLabel(line),
      effectiveProration(line),
      line.feeAmount,
      lineSegments.length > 0
        ? `Σ of ${lineSegments.length} tranche${lineSegments.length === 1 ? '' : 's'} below`
        : `${asMoney(line.portfolioValue)} × (${line.feeRatePercent}% ÷ 4) × ` +
          `(${line.daysBilled} ÷ ${line.daysInQuarter})`,
      VALUATION_SOURCE_LABEL[line.valuationSource] ?? line.valuationSource,
    ]);
    row.getCell(2).numFmt = money.numFmt;
    row.getCell(3).numFmt = '0.00%';
    row.getCell(5).numFmt = '0.00%';
    row.getCell(6).numFmt = money.numFmt;
    row.getCell(7).font = { size: 9, color: { argb: 'FF6B7280' } };
    row.getCell(8).font = { size: 9, color: { argb: 'FF6B7280' } };
    row.eachCell((cell, col) => {
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: col === 1 || col >= 7 ? 'left' : 'right' };
    });

    /**
     * One indented row per tranche — this is the audit trail. A client who
     * added money mid-quarter can point at the line and see the day-count it
     * was actually billed over.
     */
    for (const seg of lineSegments) {
      const detail = sheet.addRow([
        seg.kind === 'opening'
          ? `      opening book, from ${formatDate(seg.from)}`
          : `      ${seg.amount >= 0 ? 'deployed' : 'withdrawn'} ${formatDate(seg.from)}`,
        seg.amount,
        line.feeRatePercent / 100 / 4,
        `${seg.days} / ${line.daysInQuarter}`,
        seg.days / line.daysInQuarter,
        seg.fee,
        `${asMoney(seg.amount)} × (${line.feeRatePercent}% ÷ 4) × (${seg.days} ÷ ${line.daysInQuarter})`,
        '',
      ]);
      detail.getCell(2).numFmt = money.numFmt;
      detail.getCell(3).numFmt = '0.0000%';
      detail.getCell(5).numFmt = '0.00%';
      detail.getCell(6).numFmt = money.numFmt;
      detail.eachCell((cell, col) => {
        cell.font = { size: 9, color: { argb: 'FF6B7280' } };
        cell.border = THIN_BORDER;
        cell.alignment = { horizontal: col === 1 || col >= 7 ? 'left' : 'right' };
      });
    }
  }

  const total = sheet.addRow([
    'Total',
    invoice.totals.portfolioValue,
    '',
    '',
    '',
    invoice.totals.feeAmount,
  ]);
  total.font = { bold: true };
  total.getCell(2).numFmt = money.numFmt;
  total.getCell(6).numFmt = money.numFmt;
  total.eachCell((cell, col) => {
    cell.border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF111827' } } };
    cell.alignment = { horizontal: col === 1 ? 'left' : 'right' };
  });
}

export async function downloadFamilyInvoiceWorkbook(invoice: FamilyFeeInvoice): Promise<void> {
  const wb = await buildFamilyInvoiceWorkbook(invoice);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const family = invoice.familyName.replace(/\s+/g, '_').toLowerCase();
  const quarter = invoice.quarterLabel.replace(/\s+/g, '_').toLowerCase();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `fee-invoice-${family}-${quarter}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
