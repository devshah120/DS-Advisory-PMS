import ExcelJS from 'exceljs';
import { ClientFeeRow } from '@/types/reports';
import { formatDate } from './utils';

const LABEL_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
  right: { style: 'thin', color: { argb: 'FFD1D5DB' } },
};

/**
 * One client's fee working, laid out as a bordered label/value box — the same
 * shape as the firm's reference workbook — so a client can see exactly what
 * rate and how many days their fee was prorated over, not just the total.
 */
export async function buildClientFeeWorkbook(fee: ClientFeeRow): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DS Advisory';
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

  const rows: Array<[string, string | number, string?]> = [
    ['Annual fee rate', fee.feeRatePercent / 100, '0.00%'],
    ['Portfolio value', fee.portfolioValue, '"$"#,##0.00'],
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
  totalRow.getCell(2).numFmt = '"$"#,##0.00';
  totalRow.getCell(2).alignment = { horizontal: 'right' };
  totalRow.getCell(1).border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF111827' } } };
  totalRow.getCell(2).border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF111827' } } };

  sheet.addRow([]);
  const statusRow = sheet.addRow([
    'Status',
    fee.isEstimate ? 'Estimate (quarter in progress)' : 'Final',
  ]);
  statusRow.getCell(1).font = { size: 9, color: { argb: 'FF6B7280' } };
  statusRow.getCell(2).font = { size: 9, color: { argb: 'FF6B7280' } };

  const workingTitle = sheet.addRow(['Working']);
  workingTitle.font = { bold: true, size: 11 };
  sheet.addRow([]);

  const formula = sheet.addRow([
    'Fee = Portfolio value × (annual rate ÷ 4) × (days billed ÷ days in quarter)',
  ]);
  formula.font = { italic: true, size: 10, color: { argb: 'FF6B7280' } };
  sheet.mergeCells(formula.number, 1, formula.number, 2);

  const substituted = sheet.addRow([
    `= ${fee.portfolioValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} × ` +
      `(${fee.feeRatePercent}% ÷ 4) × (${fee.daysBilled} ÷ ${fee.daysInQuarter})`,
  ]);
  substituted.font = { size: 10 };
  sheet.mergeCells(substituted.number, 1, substituted.number, 2);

  const result = sheet.addRow([
    `= ${fee.feeAmount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`,
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
