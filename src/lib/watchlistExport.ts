import ExcelJS from 'exceljs';
import { displayTicker } from '@/lib/market-scope';
import type {
  ClientPortfolioWatchlist,
  ClientWatchlistRow,
  ClientWatchlistWindow,
  PositionWindowReturn,
} from '@/types';

const FONT_NAME = 'Calibri';
const BODY_SIZE = 11;

/** One decimal on returns, as the desk reads them; two on contributions, which run smaller. */
const RETURN_FORMAT = '0.0%';
const CONTRIBUTION_FORMAT = '0.00%';

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
};

/** Excel's own Good / Bad cell styles: a pale fill with dark text of the same hue. */
const GAIN = { fill: 'FFC6EFCE', font: 'FF006100' };
const LOSS = { fill: 'FFFFC7CE', font: 'FF9C0006' };

const RETURN_WINDOWS: ClientWatchlistWindow[] = ['mtd', 'qtd', 'ytd'];
const CONTRIBUTION_WINDOWS: ClientWatchlistWindow[] = ['mtd', 'qtd', 'inception'];
const WINDOW_LABEL: Record<ClientWatchlistWindow, string> = {
  mtd: 'MTD',
  qtd: 'QTD',
  ytd: 'YTD',
  inception: 'Since Inception',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-06-30' → '30 Jun 2026', built by hand so no viewer's zone can shift the day. */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

type Cell = string | number | null;

interface ColumnSpec {
  header: string;
  width: number;
  align: 'left' | 'right';
}

/**
 * A client's or household's watchlist as a workbook: every position with its
 * MTD / QTD / YTD return, then each position's contribution to the book's
 * return over MTD, QTD and since inception, then the book's indices.
 *
 * Returns and contributions are tinted green or red by sign, and left
 * unshaded at zero, as the desk's reference sheet does. The fills are written
 * per cell rather than as conditional-formatting rules so they survive in
 * viewers that don't evaluate rules.
 *
 * `rows` is written in the order given, so the sheet keeps whatever sort the
 * screen was showing.
 */
export function buildWatchlistWorkbook(data: ClientPortfolioWatchlist, rows: ClientWatchlistRow[]): ExcelJS.Workbook {
  const isFamily = data.kind === 'family';
  const columns: ColumnSpec[] = [
    { header: 'Symbol', width: 16, align: 'left' },
    { header: 'Company', width: 40, align: 'left' },
    // A household's sheet also says which accounts each row was merged from.
    ...(isFamily ? [{ header: 'Held in', width: 32, align: 'left' as const }] : []),
    { header: 'Sector', width: 20, align: 'left' },
    { header: 'Industry', width: 34, align: 'left' },
    { header: 'Price', width: 11, align: 'right' },
    ...RETURN_WINDOWS.map((w) => ({ header: `${WINDOW_LABEL[w]} %`, width: 9, align: 'right' as const })),
    ...CONTRIBUTION_WINDOWS.map((w) => ({
      header: `${WINDOW_LABEL[w]} Contribution`,
      width: w === 'inception' ? 16 : 14,
      align: 'right' as const,
    })),
  ];
  const firstReturnCol = columns.length - RETURN_WINDOWS.length - CONTRIBUTION_WINDOWS.length + 1;
  const firstContributionCol = firstReturnCol + RETURN_WINDOWS.length;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Giriraj Global Consultants';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Watchlist', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({ width: c.width }));

  const header = sheet.addRow(columns.map((c) => c.header));
  header.height = 30;
  header.eachCell((cell, col) => {
    cell.font = { name: FONT_NAME, size: BODY_SIZE, bold: true };
    cell.border = THIN_BORDER;
    cell.alignment = { horizontal: columns[col - 1].align, vertical: 'middle', wrapText: true };
  });

  /** Writes one figure, in percent, as a percent-formatted cell tinted by its sign. */
  const writePct = (cell: ExcelJS.Cell, pct: number | null, numFmt: string, threshold: number) => {
    if (pct == null) {
      cell.value = 'n/a';
      cell.font = { name: FONT_NAME, size: BODY_SIZE, color: { argb: 'FF808080' } };
      return;
    }
    cell.value = pct / 100;
    cell.numFmt = numFmt;
    // Below the display precision a figure reads as 0.0% and stays unshaded,
    // rather than showing a green or red 0.0% on rounding noise.
    if (Math.abs(pct) < threshold) return;
    const tone = pct > 0 ? GAIN : LOSS;
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tone.fill } };
    cell.font = { ...cell.font, color: { argb: tone.font } };
  };
  const writeReturn = (cell: ExcelJS.Cell, pct: number | null) => writePct(cell, pct, RETURN_FORMAT, 0.05);
  const writeContribution = (cell: ExcelJS.Cell, pct: number | null) =>
    writePct(cell, pct, CONTRIBUTION_FORMAT, 0.005);

  /** Base font, border and alignment on every cell of a row, figures included. */
  const styleRow = (row: ExcelJS.Row, font: Partial<ExcelJS.Font> = {}) => {
    for (let col = 1; col <= columns.length; col++) {
      const cell = row.getCell(col);
      cell.font = { name: FONT_NAME, size: BODY_SIZE, ...font };
      cell.border = THIN_BORDER;
      cell.alignment = { horizontal: columns[col - 1].align, vertical: 'middle' };
    }
  };

  /** Why a figure is missing, or that it covers less of the window than the index does. */
  const noteFor = (w: ClientWatchlistWindow, r: PositionWindowReturn): string | undefined => {
    if (r.returnPct == null) return r.reason ?? 'Not measurable over this window';
    if (r.measuredFrom > data.windows[w].from) {
      return `Held from ${fmtDate(r.measuredFrom)}, so measured over a shorter span than the index`;
    }
    return undefined;
  };

  for (const r of rows) {
    const leading: Cell[] = [
      displayTicker(r.symbol),
      r.company ?? '',
      ...(isFamily ? [r.holders.map((h) => `${h.clientName} (${h.quantity})`).join('; ')] : []),
      r.sector,
      r.industry,
      r.price,
    ];
    const row = sheet.addRow(leading);
    styleRow(row);
    RETURN_WINDOWS.forEach((w, i) => {
      const cell = row.getCell(firstReturnCol + i);
      writeReturn(cell, r[w].returnPct);
      const note = noteFor(w, r[w]);
      if (note) cell.note = note;
    });
    CONTRIBUTION_WINDOWS.forEach((w, i) => writeContribution(row.getCell(firstContributionCol + i), r[w].contributionPct));
  }

  // What the listed names don't explain: positions sold out inside a window,
  // and fees or income booked without a symbol. Without it the column would
  // not foot to the portfolio line below.
  const attributions = CONTRIBUTION_WINDOWS.map((w) => data.windows[w].attribution);
  if (attributions.some((a) => a && Math.abs(a.otherPct) >= 0.005)) {
    const row = sheet.addRow(['Sold during period & fees']);
    styleRow(row, { italic: true });
    attributions.forEach((a, i) => writeContribution(row.getCell(firstContributionCol + i), a?.otherPct ?? null));
  }

  const total = sheet.addRow(['Portfolio']);
  styleRow(total, { bold: true });
  total.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = { ...THIN_BORDER, top: { style: 'medium', color: { argb: 'FF000000' } } };
  });
  attributions.forEach((a, i) => {
    const cell = total.getCell(firstContributionCol + i);
    writeContribution(cell, a?.totalPct ?? null);
    cell.font = { ...cell.font, bold: true };
  });

  sheet.addRow([]);
  for (const b of data.benchmarks) {
    const row = sheet.addRow([b.label]);
    styleRow(row);
    row.getCell(1).font = { name: FONT_NAME, size: BODY_SIZE, bold: true };
    // An index has no contribution to the book; those cells stay blank but ruled.
    RETURN_WINDOWS.forEach((w, i) => writeReturn(row.getCell(firstReturnCol + i), b[w]));
  }

  sheet.addRow([]);
  const notes = [
    `As of ${fmtDate(data.asOf)}. Returns are money-weighted for ${
      isFamily ? 'the household as one account' : "this client's own holding"
    }, so purchases and sales inside a window are not counted as gain or loss.`,
    ...[...RETURN_WINDOWS, 'inception' as const].map((w) => {
      const m = data.windows[w];
      const name = m.label.toLowerCase() === WINDOW_LABEL[w].toLowerCase() ? m.label : `${WINDOW_LABEL[w]} (${m.label})`;
      return `${name}: ${fmtDate(m.from)} to ${fmtDate(m.to)}.`;
    }),
    'Contribution: what the position gained or lost over the period, as a share of the portfolio. With no ' +
      'purchases or sales that is allocation at the start of the period × the stock’s return, so a 10% ' +
      'position that rises 10% contributes +1.00%. Capital added or withdrawn during the period widens or ' +
      'narrows the base rather than being counted as return.',
    'The contributions add up to the Portfolio line, a flow-adjusted (Modified Dietz) return on capital ' +
      'invested. It can differ slightly from the money-weighted figure on the Performance page.',
  ];
  for (const note of notes) {
    const row = sheet.addRow([note]);
    row.getCell(1).font = { name: FONT_NAME, size: BODY_SIZE - 1, italic: true, color: { argb: 'FF595959' } };
  }

  return wb;
}

/** Builds the workbook and hands it to the browser as an .xlsx download. */
export async function downloadWatchlistWorkbook(
  data: ClientPortfolioWatchlist,
  rows: ClientWatchlistRow[]
): Promise<void> {
  const wb = buildWatchlistWorkbook(data, rows);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${data.name.replace(/\s+/g, '_').toLowerCase()}_watchlist_${data.asOf}.xlsx`;
  link.click();
  URL.revokeObjectURL(link.href);
}
