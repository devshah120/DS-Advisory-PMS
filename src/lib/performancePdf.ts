import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { PeriodReturn, PortfolioAsOf } from './portfolio-history.api';
import type { FamilyPeriodReturn } from './family-performance.api';
import {
  BORDER,
  COL_W,
  CONTENT_W,
  drawAmountsCaption,
  drawBanner,
  drawIdentity,
  amountFormatter,
  GUTTER,
  INK,
  LIGHT_NAVY,
  loadPdfFonts,
  MARGIN,
  MUTED,
  NAVY,
  newDoc,
  PAGE_H,
  PAGE_W,
  PDF_FONT,
  RULE_W,
  stampPageNumbers,
  WHITE,
  ZEBRA,
} from './pdfChrome';
import {
  familyLeftPanels,
  familyRightLines,
  familyTimeFrameLabel,
  fmtLongDate,
  headlineLabel,
  memberReturn,
  NOT_AVAILABLE,
  periodLeftPanels,
  periodNotes,
  periodRightLines,
  periodTimeFrameLabel,
  STATEMENT_FOOTER,
  type Line,
} from './performanceExport';
import { returnBasis, signedPct } from './returnBasis';

/**
 * The Performance Summary as a PDF — the client-facing rendering of the exact
 * statement `performanceExport.ts` builds as a workbook.
 *
 * `performanceExport.ts` owns WHAT the statement says (which figures, in which
 * order, under which labels) and this file owns only HOW that is drawn. The
 * frame — Perpetua, the navy palette, the banner and the page footer — comes
 * from `pdfChrome.ts`, shared with every other client document.
 */

type Money = (n: number) => string;

/** Signed, two decimals, everywhere a rate is printed. */
const rateText = (v: number) => signedPct(v, 2);
/** Unsigned two decimals, for weights and other shares. */
const shareText = (v: number) => `${(v * 100).toFixed(2)}%`;

/** Shared table styling: Perpetua, ink text, 0.5pt slate rules. */
const TABLE_STYLES = {
  font: PDF_FONT,
  fontSize: 9.5,
  cellPadding: { top: 4.5, bottom: 4.5, left: 6, right: 6 },
  lineColor: BORDER,
  lineWidth: RULE_W,
  textColor: INK,
  overflow: 'linebreak' as const,
};

const HEAD_STYLES = {
  fillColor: NAVY,
  textColor: WHITE,
  fontStyle: 'bold' as const,
  fontSize: 9.5,
  lineColor: NAVY,
  lineWidth: RULE_W,
};

const FOOT_STYLES = {
  fillColor: LIGHT_NAVY,
  textColor: INK,
  fontStyle: 'bold' as const,
  fontSize: 9.5,
  lineColor: BORDER,
  lineWidth: RULE_W,
};

/** Renders one panel line's value the way its `kind` says it should read. */
function lineValue(line: Line, money: Money): string {
  const { value, kind } = line;
  if (value === null || value === undefined) return NOT_AVAILABLE;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return fmtLongDate(value);
  switch (kind) {
    case 'money':
      return money(value);
    case 'percent':
      return rateText(value);
    case 'percentPlain':
      return shareText(value);
    default:
      return String(value);
  }
}

/** One titled panel of label/value rows: navy header, zebra rows, light-navy totals. */
function drawPanel(
  doc: jsPDF,
  opts: { title: string; lines: Line[]; x: number; y: number; width: number; money: Money },
): number {
  const { title, lines, x, y, width, money } = opts;

  autoTable(doc, {
    startY: y,
    margin: { left: x, right: PAGE_W - x - width },
    tableWidth: width,
    theme: 'plain',
    head: [[{ content: title, colSpan: 2 }]],
    body: lines.map((l) => [l.label, lineValue(l, money)]),
    headStyles: { ...HEAD_STYLES, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 } },
    styles: TABLE_STYLES,
    columnStyles: {
      0: { cellWidth: width * 0.56 },
      1: { cellWidth: width * 0.44, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const line = lines[data.row.index];
      if (!line) return;

      if (line.total) {
        data.cell.styles.fillColor = LIGHT_NAVY;
        data.cell.styles.fontStyle = 'bold';
      } else {
        data.cell.styles.fillColor = data.row.index % 2 === 0 ? WHITE : ZEBRA;
      }

      // A reason string is prose, not a figure: left-aligned and smaller.
      if (data.column.index === 1 && line.kind === 'text' && typeof line.value === 'string' && line.value.length > 24) {
        data.cell.styles.halign = 'left';
        data.cell.styles.fontSize = 8.5;
        data.cell.styles.fontStyle = 'italic';
      }
    },
  });

  return (doc as any).lastAutoTable.finalY as number;
}

/**
 * The KPI band: the headline return, the benchmark and alpha, all on the same
 * basis from `returnBasis()` — period figures under a year, per-annum at a year
 * or more — so the three always reconcile (return − benchmark = alpha).
 */
function drawHeadline(
  doc: jsPDF,
  r: PeriodReturn | FamilyPeriodReturn,
  y: number,
): number {
  const b = returnBasis(r);
  const h = 62;
  const third = CONTENT_W / 3;

  doc.setFillColor(...LIGHT_NAVY);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(RULE_W);
  doc.rect(MARGIN, y, CONTENT_W, h, 'FD');
  doc.line(MARGIN + third, y + 10, MARGIN + third, y + h - 10);
  doc.line(MARGIN + third * 2, y + 10, MARGIN + third * 2, y + h - 10);

  const caption = (x: number, text: string) => {
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(text.toUpperCase(), x, y + 16);
  };
  const figure = (x: number, v: number | null, size: number) => {
    doc.setFont(PDF_FONT, 'bold');
    if (v === null) {
      // Never 0.00%: a zero claims "measured, and flat", which is false here.
      doc.setFontSize(12);
      doc.setTextColor(...MUTED);
      doc.text(NOT_AVAILABLE, x, y + 38);
      return;
    }
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    doc.text(`${rateText(v)}${b.suffix}`, x, y + 40);
  };
  const sub = (x: number, text: string) => {
    doc.setFont(PDF_FONT, 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(doc.splitTextToSize(text, third - 24)[0], x, y + 53);
  };

  const x1 = MARGIN + 12;
  const x2 = MARGIN + third + 12;
  const x3 = MARGIN + third * 2 + 12;

  caption(x1, headlineLabel(r));
  figure(x1, b.portfolio, 22);
  if (b.portfolio === null && r.returnReason) sub(x1, r.returnReason);

  caption(x2, 'Benchmark');
  figure(x2, b.benchmark, 16);
  sub(x2, r.benchmark?.name ?? r.benchmark?.code ?? 'No benchmark configured');

  caption(x3, 'Alpha');
  figure(x3, b.alpha, 16);
  sub(x3, 'Portfolio less benchmark');

  return y + h + 14;
}

/** Lays the two panel columns side by side and returns the lower of the two. */
function drawTwoColumns(
  doc: jsPDF,
  y: number,
  leftPanels: Array<{ title: string; lines: Line[] }>,
  rightLines: Line[],
  money: Money,
): number {
  let leftY = y;
  leftPanels.forEach((panel, i) => {
    leftY = drawPanel(doc, {
      title: panel.title,
      lines: panel.lines,
      x: MARGIN,
      y: i === 0 ? y : leftY + 12,
      width: COL_W,
      money,
    });
  });

  const rightY = drawPanel(doc, {
    title: 'PERFORMANCE METRICS',
    lines: rightLines,
    x: MARGIN + COL_W + GUTTER,
    y,
    width: COL_W,
    money,
  });

  return Math.max(leftY, rightY);
}

/** Material caveats, if any, set small beneath the panels. */
function drawNotes(doc: jsPDF, y: number, notes: string[]): void {
  if (!notes.length) return;
  doc.setFont(PDF_FONT, 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  let cursor = y + 16;
  for (const note of notes) {
    const wrapped = doc.splitTextToSize(note, CONTENT_W) as string[];
    doc.text(wrapped, MARGIN, cursor);
    cursor += wrapped.length * 10;
  }
}

/**
 * A full-width detail table on the same portrait page as the summary, under a
 * navy title bar, with its column headers in light navy beneath. A long table
 * continues onto further portrait pages, repeating both header rows, so the
 * document never switches orientation part-way through.
 */
function detailHead(title: string, columns: string[], firstNumericCol: number) {
  return [
    [{ content: title, colSpan: columns.length, styles: { ...HEAD_STYLES, halign: 'left' as const } }],
    columns.map((c, i) => ({
      content: c,
      styles: {
        fillColor: LIGHT_NAVY,
        textColor: INK,
        fontStyle: 'bold' as const,
        lineColor: BORDER,
        lineWidth: RULE_W,
        halign: i >= firstNumericCol ? ('right' as const) : ('left' as const),
      },
    })),
  ];
}

/** Space between the summary panels and the detail table below them. */
const SECTION_GAP = 22;
/** Room kept clear above the page footer stamp. */
const FOOTER_CLEARANCE = 44;

/** The holdings detail, under the summary, ranked by market value. */
function drawHoldingsTable(doc: jsPDF, asOf: PortfolioAsOf, money: Money, y: number): number {
  const positions = [...asOf.positions].sort((a, b) => b.marketValue - a.marketValue);

  autoTable(doc, {
    startY: y + SECTION_GAP,
    margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: FOOTER_CLEARANCE },
    theme: 'plain',
    showHead: 'everyPage',
    head: detailHead(
      `HOLDINGS AS AT ${fmtLongDate(asOf.asOfDate).toUpperCase()}`,
      ['Ticker', 'Sector', 'Quantity', 'Avg Cost', 'Close', 'Market Value', 'Cost Basis', 'Unrealized', 'Weight'],
      2,
    ),
    body: positions.map((p) => [
      p.ticker,
      p.sector || '—',
      p.quantity.toLocaleString('en-IN', { maximumFractionDigits: 4 }),
      money(p.averageCost),
      money(p.closingPrice),
      money(p.marketValue),
      money(p.costBasisTotal),
      money(p.unrealizedGain),
      shareText(p.weight),
    ]),
    foot: [[
      'TOTAL',
      '',
      '',
      '',
      '',
      money(asOf.holdingsValue),
      money(asOf.totalCost),
      money(asOf.unrealizedGain),
      shareText(positions.reduce((s, p) => s + p.weight, 0)),
    ]],
    footStyles: FOOT_STYLES,
    styles: { ...TABLE_STYLES, fontSize: 8.5, cellPadding: { top: 4, bottom: 4, left: 4, right: 4 } },
    columnStyles: {
      0: { fontStyle: 'bold' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right' },
    },
    alternateRowStyles: { fillColor: ZEBRA },
    didParseCell: (data) => {
      if (data.section === 'foot' && data.column.index >= 2) data.cell.styles.halign = 'right';
    },
  });
  return (doc as any).lastAutoTable.finalY as number;
}

/**
 * The per-account breakdown, under the household summary. Member returns are
 * each account's own figure and deliberately do not average to the
 * household's; Net Gain is the column that sums.
 */
function drawMembersTable(doc: jsPDF, fr: FamilyPeriodReturn, money: Money, y: number): number {
  const members = [...fr.members].sort((a, b) => b.closingValue - a.closingValue);
  const ret = (v: number | null) => (v === null ? NOT_AVAILABLE : rateText(v));

  autoTable(doc, {
    startY: y + SECTION_GAP,
    margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: FOOTER_CLEARANCE },
    theme: 'plain',
    showHead: 'everyPage',
    head: detailHead(
      `ACCOUNTS IN ${fr.familyName.toUpperCase()}`,
      ['Account', 'Opening', 'Net Flows', 'Closing', 'Net Gain', 'Return', 'Weight'],
      1,
    ),
    body: members.map((m) => [
      m.entryDate ? `${m.clientName} · joined ${fmtLongDate(m.entryDate)}` : m.clientName,
      money(m.openingValue),
      money(m.netFlows),
      money(m.closingValue),
      money(m.gain),
      ret(memberReturn(m)),
      shareText(m.weight),
    ]),
    foot: [[
      'HOUSEHOLD',
      money(fr.openingValue),
      money(fr.netFlows),
      money(fr.closingValue),
      money(fr.closingValue - fr.openingValue - fr.netFlows),
      ret(fr.returnPct),
      shareText(1),
    ]],
    footStyles: FOOT_STYLES,
    styles: TABLE_STYLES,
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: CONTENT_W * 0.25 },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
    alternateRowStyles: { fillColor: ZEBRA },
    didParseCell: (data) => {
      if (data.section === 'foot' && data.column.index >= 1) data.cell.styles.halign = 'right';
    },
  });
  return (doc as any).lastAutoTable.finalY as number;
}

/** Builds the client period statement as a PDF document. Fonts must be loaded. */
export function buildPeriodPerformancePdf(
  clientName: string,
  pr: PeriodReturn,
  asOf: PortfolioAsOf | null,
  currency: string,
): jsPDF {
  const doc = newDoc();
  doc.setProperties({
    title: `Performance Summary — ${clientName} — ${periodTimeFrameLabel(pr)}`,
    author: 'Giriraj Global Consultants',
    subject: 'Performance Summary',
  });

  const money = amountFormatter(currency);

  let y = drawBanner(doc);
  y = drawIdentity(doc, clientName, new Date(pr.to), periodTimeFrameLabel(pr), y);
  y = drawHeadline(doc, pr, y);
  y = drawAmountsCaption(doc, currency, y);
  y = drawTwoColumns(doc, y, periodLeftPanels(pr, asOf), periodRightLines(pr), money);
  if (asOf && asOf.positions.length) y = drawHoldingsTable(doc, asOf, money, y);
  drawNotes(doc, y, periodNotes(pr, asOf));

  stampPageNumbers(doc, STATEMENT_FOOTER);
  return doc;
}

/** Builds the household period statement as a PDF document. Fonts must be loaded. */
export function buildFamilyPerformancePdf(fr: FamilyPeriodReturn, currency: string): jsPDF {
  const doc = newDoc();
  doc.setProperties({
    title: `Performance Summary — ${fr.familyName} — ${familyTimeFrameLabel(fr)}`,
    author: 'Giriraj Global Consultants',
    subject: 'Household Performance Summary',
  });

  const money = amountFormatter(currency);

  let y = drawBanner(doc);
  y = drawIdentity(doc, fr.familyName, new Date(fr.to), familyTimeFrameLabel(fr), y);
  y = drawHeadline(doc, fr, y);
  y = drawAmountsCaption(doc, currency, y);
  y = drawTwoColumns(doc, y, familyLeftPanels(fr), familyRightLines(fr), money);
  if (fr.members.length) drawMembersTable(doc, fr, money, y);

  stampPageNumbers(doc, STATEMENT_FOOTER);
  return doc;
}

/**
 * Filenames carry the WINDOW as well as the date: two statements struck the
 * same day for different periods are different documents.
 */
function fileSlug(name: string, label: string, to: string): string {
  const subject = name.replace(/\s+/g, '_').toLowerCase();
  const period = label.replace(/[^\w]+/g, '-').toLowerCase();
  return `${subject}-performance-${period}-${to.slice(0, 10)}`;
}

export async function downloadPeriodPerformancePdf(
  clientName: string,
  pr: PeriodReturn,
  asOf: PortfolioAsOf | null,
  currency: string,
): Promise<void> {
  await loadPdfFonts();
  const doc = buildPeriodPerformancePdf(clientName, pr, asOf, currency);
  doc.save(`${fileSlug(clientName, pr.label, pr.to)}.pdf`);
}

export async function downloadFamilyPerformancePdf(fr: FamilyPeriodReturn, currency: string): Promise<void> {
  await loadPdfFonts();
  const doc = buildFamilyPerformancePdf(fr, currency);
  doc.save(`${fileSlug(`${fr.familyName}-household`, fr.label, fr.to)}.pdf`);
}
