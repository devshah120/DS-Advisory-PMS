import ExcelJS from 'exceljs';
import { ClientFeeRow, FamilyFeeInvoice } from '@/types/reports';
import { formatDate } from './utils';

const LABEL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };

const VALUATION_SOURCE_LABEL: Record<string, string> = {
  snapshot: 'Quarter-end snapshot (recorded on the day)',
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
 * One client's fee working, laid out as a bordered label/value box — the same
 * shape as the firm's reference workbook — so a client can see exactly what
 * rate and how many days their fee was prorated over, not just the total.
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

  // A closed quarter is billed on its locked quarter-end NAV; an open one can
  // only show today's moving value. Labelling the row tells the reader which
  // they are looking at, so an estimate is never mistaken for an invoice.
  const valueLabel = fee.isEstimate
    ? 'Portfolio value (live, quarter in progress)'
    : 'Portfolio value (quarter-end)';

  const rows: Array<[string, string | number, string?]> = [
    ['Annual fee rate', fee.feeRatePercent / 100, '0.00%'],
    [valueLabel, fee.portfolioValue, money.numFmt],
    ['Days billed this quarter', `${fee.daysBilled} / ${fee.daysInQuarter}`],
    ['Quarterly rate (annual ÷ 4)', fee.feeRatePercent / 100 / 4, '0.0000%'],
    ['Proration (days billed ÷ days in quarter)', fee.daysBilled / fee.daysInQuarter, '0.00%'],
  ];

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

  sheet.addRow([]);
  const statusRow = sheet.addRow([
    'Status',
    fee.isEstimate ? 'Estimate (quarter in progress)' : 'Final — billed',
  ]);
  statusRow.getCell(1).font = { size: 9, color: { argb: 'FF6B7280' } };
  statusRow.getCell(2).font = { size: 9, color: { argb: 'FF6B7280' } };

  // Where the portfolio value came from. A reconstructed value is as correct
  // as a stored one but was replayed rather than recorded on the day, and a
  // reader auditing an old invoice needs to be able to tell the difference.
  const sourceRow = sheet.addRow(['Valuation source', VALUATION_SOURCE_LABEL[fee.valuationSource] ?? fee.valuationSource]);
  sourceRow.getCell(1).font = { size: 9, color: { argb: 'FF6B7280' } };
  sourceRow.getCell(2).font = { size: 9, color: { argb: 'FF6B7280' } };

  const workingTitle = sheet.addRow(['Working']);
  workingTitle.font = { bold: true, size: 11 };
  sheet.addRow([]);

  const formula = sheet.addRow([
    'Fee = Portfolio value × (annual rate ÷ 4) × (days billed ÷ days in quarter)',
  ]);
  formula.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(formula.number, 1, formula.number, 2);

  const substituted = sheet.addRow([
    `= ${fee.portfolioValue.toLocaleString(money.locale, {
      style: 'currency',
      currency: fee.currency ?? 'USD',
    })} × ` + `(${fee.feeRatePercent}% ÷ 4) × (${fee.daysBilled} ÷ ${fee.daysInQuarter})`,
  ]);
  substituted.font = { size: 10 };
  sheet.mergeCells(substituted.number, 1, substituted.number, 2);

  const result = sheet.addRow([
    `= ${fee.feeAmount.toLocaleString(money.locale, {
      style: 'currency',
      currency: fee.currency ?? 'USD',
    })}`,
  ]);
  result.font = { bold: true, size: 10 };
  sheet.mergeCells(result.number, 1, result.number, 2);

  return wb;
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
    invoice.isEstimate ? 'Portfolio value (live)' : 'Portfolio value (quarter-end)',
    'Annual rate',
    'Days billed',
    'Proration',
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
      `${line.daysBilled} / ${line.daysInQuarter}`,
      line.daysBilled / line.daysInQuarter,
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

  // --- working --------------------------------------------------------------
  sheet.addRow([]);
  const workingTitle = sheet.addRow(['Working']);
  workingTitle.font = { bold: true, size: 11 };

  const formula = sheet.addRow([
    'Fee per account = Portfolio value × (annual rate ÷ 4) × (days billed ÷ days in quarter)',
  ]);
  formula.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(formula.number, 1, formula.number, 6);

  const summed = sheet.addRow([
    'Household total = the sum of the account fees above. Each account is billed at its own ' +
      'rate and prorated by its own inception date, so this invoice reconciles line-for-line ' +
      'with each account’s individual fee statement.',
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
 * reads. Keeping the valuation provenance and the substituted arithmetic off
 * the main sheet stops a six-line bill turning into a page of machinery.
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

  const title = sheet.addRow([`${invoice.familyName} — ${invoice.quarterLabel} account detail`]);
  title.font = { bold: true, size: 12 };
  sheet.mergeCells(title.number, 1, title.number, 8);
  sheet.addRow([]);

  const header = sheet.addRow([
    'Account',
    'Portfolio value',
    'Annual rate',
    'Days billed',
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

  for (const line of invoice.lines) {
    const row = sheet.addRow([
      line.clientName,
      line.portfolioValue,
      line.feeRatePercent / 100,
      `${line.daysBilled} / ${line.daysInQuarter}`,
      line.daysBilled / line.daysInQuarter,
      line.feeAmount,
      `${line.portfolioValue.toLocaleString(money.locale, {
        style: 'currency',
        currency: line.currency ?? 'USD',
      })} × (${line.feeRatePercent}% ÷ 4) × (${line.daysBilled} ÷ ${line.daysInQuarter})`,
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
