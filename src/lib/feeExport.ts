import ExcelJS from 'exceljs';
import { ClientFeeRow } from '@/types/reports';
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
  wb.creator = 'Giriraj Global Capital';
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
