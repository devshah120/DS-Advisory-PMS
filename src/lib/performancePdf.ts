import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { PeriodReturn, PortfolioAsOf } from './portfolio-history.api';
import type { FamilyPeriodReturn } from './family-performance.api';
import {
  familyLeftPanels,
  familyNotes,
  familyRightLines,
  familyTimeFrameLabel,
  fmtDate,
  NOT_AVAILABLE,
  periodLeftPanels,
  periodNotes,
  periodRightLines,
  periodTimeFrameLabel,
  type Line,
} from './performanceExport';

/**
 * The Performance Summary as a PDF — the client-facing rendering of the exact
 * statement `performanceExport.ts` builds as a workbook.
 *
 * The division of labour between the two files is the point of this one:
 * `performanceExport.ts` owns WHAT the statement says (which figures, in which
 * order, under which headings, with which caveats) and this file owns only HOW
 * that is drawn on a page. Every panel, line, time-frame label and footnote
 * here is imported from there rather than restated — so a change to the
 * statement's content lands in both documents at once, and the PDF a client
 * receives can never quote a different number, or a different caveat, from the
 * workbook their adviser is reading.
 *
 * That constraint is worth the indirection. A firm that emails a PDF and keeps
 * an XLSX has two records of one quarter; the moment those disagree, neither is
 * evidence of anything.
 */

/** The palette, as RGB triples. The workbook speaks ARGB hex; jsPDF speaks RGB. */
const NAVY: [number, number, number] = [11, 31, 58];
const GOLD: [number, number, number] = [201, 162, 39];
const GOLD_FILL: [number, number, number] = [244, 233, 199];
const STONE: [number, number, number] = [247, 245, 240];
const WHITE: [number, number, number] = [255, 255, 255];
const GREY: [number, number, number] = [91, 100, 114];
const INK: [number, number, number] = [26, 26, 26];
const CALC_BLUE: [number, number, number] = [31, 78, 156];
const HAIRLINE: [number, number, number] = [217, 217, 217];

/** A4 portrait in points, with the margin the workbook's print setup implies. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
/** Two panel columns with a gutter, mirroring the workbook's A/B | D/E layout. */
const GUTTER = 16;
const COL_W = (CONTENT_W - GUTTER) / 2;

/**
 * Money, in the mandate's own currency and its own digit grouping.
 *
 * Indian statements group in lakh/crore, and a ₹1,24,50,000 rendered as
 * ₹12,450,000 is the kind of error a client notices immediately and an adviser
 * never does. `Intl` is asked for the grouping; the symbol is prepended
 * separately because jsPDF's standard fonts have no glyph for ₹ — see
 * `currencyPrefix`.
 */
function moneyFormatter(currency: string): (n: number) => string {
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const prefix = currencyPrefix(currency);
  return (n: number) => {
    // Parentheses for negatives, the accounting convention the workbook uses.
    const body = `${prefix}${nf.format(Math.abs(n))}`;
    return n < 0 ? `(${body})` : body;
  };
}

/**
 * The currency's prefix, in characters the PDF's font can actually draw.
 *
 * jsPDF's built-in Helvetica is WinAnsi-encoded and has no ₹ glyph — emitting
 * one produces a blank or a mojibake box in the reader, on a document that goes
 * to a client. "INR " is used instead: unambiguous, and it renders. $ is in the
 * encoding, so it is used directly.
 */
function currencyPrefix(currency: string): string {
  if (currency === 'INR') return 'INR ';
  if (currency === 'USD') return '$';
  return `${currency} `;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/**
 * Typographic characters, rewritten to ones the PDF font can actually draw.
 *
 * jsPDF's built-in Helvetica is WinAnsi-encoded: anything above U+00FF is not
 * merely unsupported, it is silently corrupted. An arrow becomes "!", an em
 * dash and a curly apostrophe vanish entirely, and "₹" comes out as " ¹" — all
 * without an error, on a document that goes to a client.
 *
 * The fix belongs here rather than in the shared content builders, because the
 * strings those produce are correct: the workbook renders "→" and "—" perfectly
 * and should keep them. Only this renderer has the limitation, so only this
 * renderer compensates for it — which is also what keeps the two documents
 * saying the same thing rather than one of them being quietly de-punctuated at
 * the source.
 *
 * Applied at every draw call, so no string reaches the page untranslated.
 */
const GLYPH_MAP: Array<[RegExp, string]> = [
  [/[→➡]/g, '->'],
  [/[←]/g, '<-'],
  [/[—–]/g, '-'],
  [/[‘’‛]/g, "'"],
  [/[“”‟]/g, '"'],
  [/…/g, '...'],
  [/[•·]/g, '·'],
  [/−/g, '-'],
  [/₹/g, 'INR '],
  [/€/g, 'EUR '],
  [/\u00a0/g, ' '],
];

function ascii(text: string): string {
  let out = text;
  for (const [re, to] of GLYPH_MAP) out = out.replace(re, to);
  // Anything still outside the encodable range would be corrupted silently.
  // A visible "?" is the honest rendering of a character this font cannot draw.
  return out.replace(/[^\x20-\xFF]/g, '?');
}

/** `ascii` applied through a string or an array of them, preserving shape. */
function asciiAny<T extends string | string[]>(text: T): T {
  return (Array.isArray(text) ? text.map(ascii) : ascii(text as string)) as T;
}

/**
 * A document whose text primitives transcode on the way in.
 *
 * Patched once at construction rather than at each call site: this file draws
 * from a dozen places and autoTable draws from many more inside itself, and a
 * single forgotten `ascii()` is an invisible defect — it produces a plausible
 * document with one mangled character in it. Wrapping the two entry points
 * (`text` and `splitTextToSize`, which also measures for wrapping and so must
 * see the same string that will be drawn) makes the guarantee structural.
 */
function newDoc(orientation: 'portrait' | 'landscape' = 'portrait'): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation });

  const text = doc.text.bind(doc);
  (doc as any).text = (t: any, x: number, y: number, ...rest: any[]) =>
    text(typeof t === 'string' || Array.isArray(t) ? asciiAny(t) : t, x, y, ...rest);

  const split = doc.splitTextToSize.bind(doc);
  (doc as any).splitTextToSize = (t: any, w: number, ...rest: any[]) =>
    split(typeof t === 'string' ? ascii(t) : t, w, ...rest);

  return doc;
}

/** Renders one panel line's value the way its `kind` says it should read. */
function lineValue(line: Line, money: (n: number) => string): string {
  const { value, kind } = line;
  if (value === null || value === undefined) return NOT_AVAILABLE;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return fmtDate(value);
  switch (kind) {
    case 'money':
      return money(value);
    case 'percent':
    case 'percentPlain':
      return pct(value);
    default:
      return String(value);
  }
}

/**
 * The navy masthead and its gold confidentiality strip — the workbook's banner,
 * drawn rather than filled into cells.
 */
function drawBanner(doc: jsPDF): number {
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, PAGE_W, 54, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...WHITE);
  doc.text('GIRIRAJ GLOBAL CONSULTANTS', MARGIN, 26);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GOLD);
  doc.text('Equity & ETF Advisory', MARGIN, 40);

  doc.setFillColor(...GOLD);
  doc.rect(0, 54, PAGE_W, 2.5, 'F');

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7.5);
  doc.setTextColor(...GOLD);
  doc.text('PRIVATE & CONFIDENTIAL', PAGE_W - MARGIN, 40, { align: 'right' });

  return 74;
}

/**
 * Who the statement is for, when it was struck, and the window it covers.
 *
 * The time-frame line is imported verbatim from the workbook's own label
 * builder, which is what carries the "opened at inception, N days short" and
 * "period still open" qualifications. Those qualifications change what the
 * headline return MEANS, so they belong in the identity block beside it rather
 * than in a footnote.
 */
function drawIdentity(doc: jsPDF, subject: string, asOf: Date, timeFrame: string, y: number): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(subject, MARGIN, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text(`Statement as at ${fmtDate(asOf)}`, PAGE_W - MARGIN, y, { align: 'right' });

  let cursor = y + 15;

  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  // The label carries the window's real dates and any clamp warning, so it can
  // run long. Wrapped rather than clipped: a truncated "…short of the full
  // window" is precisely the half of the sentence that must not be lost.
  const wrapped = doc.splitTextToSize(timeFrame, CONTENT_W);
  doc.text(wrapped, MARGIN, cursor);
  cursor += wrapped.length * 11;

  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, cursor, PAGE_W - MARGIN, cursor);

  return cursor + 16;
}

/**
 * One titled panel of label/value rows, drawn as an autoTable so the row
 * banding, the gold total rows and the blue/black calculated-vs-recorded
 * legend all match the workbook cell for cell.
 */
function drawPanel(
  doc: jsPDF,
  opts: {
    title: string;
    lines: Line[];
    x: number;
    y: number;
    width: number;
    money: (n: number) => string;
  },
): number {
  const { title, lines, x, y, width, money } = opts;

  autoTable(doc, {
    startY: y,
    margin: { left: x, right: PAGE_W - x - width },
    tableWidth: width,
    theme: 'plain',
    head: [[title, '']],
    body: lines.map((l) => [l.label, lineValue(l, money)]),
    headStyles: {
      fillColor: NAVY,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 8,
      cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
    },
    styles: {
      font: 'helvetica',
      fontSize: 8.5,
      cellPadding: { top: 4.5, bottom: 4.5, left: 6, right: 6 },
      lineColor: HAIRLINE,
      lineWidth: 0.4,
      textColor: INK,
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { cellWidth: width * 0.56, textColor: GREY },
      1: { cellWidth: width * 0.44, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const line = lines[data.row.index];
      if (!line) return;

      // Gold, heavier type for the totals — Portfolio Value, Closing Value,
      // Total Gain: the figures a reader looks for before any other.
      if (line.total) {
        data.cell.styles.fillColor = GOLD_FILL;
        data.cell.styles.fontStyle = 'bold';
        if (data.column.index === 0) data.cell.styles.textColor = NAVY;
      } else {
        data.cell.styles.fillColor = data.row.index % 2 === 0 ? STONE : WHITE;
      }

      if (data.column.index === 1 && !line.total) {
        // The workbook's legend: blue for a calculated field, near-black for
        // one taken as recorded. The footer explains it; both files honour it.
        data.cell.styles.textColor = line.input ? INK : CALC_BLUE;
      }

      // A reason string ("Return unavailable: fewer than two flows") is prose,
      // not a figure — it reads left-aligned at a smaller size rather than
      // right-aligned like the numbers it stands in for.
      if (data.column.index === 1 && line.kind === 'text' && typeof line.value === 'string') {
        if (line.value.length > 24) {
          data.cell.styles.halign = 'left';
          data.cell.styles.fontSize = 7.5;
          data.cell.styles.fontStyle = 'italic';
        }
      }
    },
  });

  return (doc as any).lastAutoTable.finalY as number;
}

/**
 * The headline band: the one number the statement exists to deliver, with the
 * benchmark and alpha beside it.
 *
 * Given its own full-width block above the panels because a review meeting
 * opens on this figure. In the workbook it sits in the metrics panel and is
 * found by reading; on a page that is printed and handed across a table it is
 * worth the space to make it unmissable.
 */
function drawHeadline(
  doc: jsPDF,
  opts: {
    y: number;
    label: string;
    returnPct: number | null;
    returnReason?: string;
    benchmarkName: string | null;
    benchmarkPct: number | null;
    alpha: number | null;
  },
): number {
  const { y, label, returnPct, returnReason, benchmarkName, benchmarkPct, alpha } = opts;
  const h = 62;

  doc.setFillColor(...STONE);
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.5);
  doc.rect(MARGIN, y, CONTENT_W, h, 'FD');

  const third = CONTENT_W / 3;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...GREY);
  doc.text(label.toUpperCase(), MARGIN + 12, y + 16);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  if (returnPct === null) {
    // Never a dash and never 0.0%: a zero here would read as "we measured this
    // and it was flat", which is a different claim from "we could not measure
    // it" and a false one.
    doc.setFontSize(11);
    doc.setTextColor(...GREY);
    doc.text('Not available', MARGIN + 12, y + 40);
    if (returnReason) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(7);
      const reason = doc.splitTextToSize(returnReason, third - 20);
      doc.text(reason.slice(0, 2), MARGIN + 12, y + 51);
    }
  } else {
    doc.setTextColor(...(returnPct >= 0 ? NAVY : ([176, 42, 42] as [number, number, number])));
    doc.text(`${returnPct > 0 ? '+' : ''}${(returnPct * 100).toFixed(2)}%`, MARGIN + 12, y + 42);
  }

  doc.setDrawColor(...HAIRLINE);
  doc.line(MARGIN + third, y + 10, MARGIN + third, y + h - 10);
  doc.line(MARGIN + third * 2, y + 10, MARGIN + third * 2, y + h - 10);

  const cell = (x: number, caption: string, value: string, sub?: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(caption.toUpperCase(), x, y + 16);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...INK);
    doc.text(value, x, y + 36);
    if (sub) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...GREY);
      doc.text(doc.splitTextToSize(sub, third - 24)[0], x, y + 50);
    }
  };

  cell(
    MARGIN + third + 12,
    'Benchmark',
    benchmarkPct === null ? 'n/a' : `${benchmarkPct > 0 ? '+' : ''}${(benchmarkPct * 100).toFixed(2)}%`,
    benchmarkName ?? 'No benchmark configured',
  );

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...GREY);
  doc.text('ALPHA', MARGIN + third * 2 + 12, y + 16);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  if (alpha === null) {
    doc.setFontSize(11);
    doc.setTextColor(...GREY);
    doc.text('n/a', MARGIN + third * 2 + 12, y + 36);
  } else {
    doc.setTextColor(...(alpha >= 0 ? ([21, 128, 61] as [number, number, number]) : ([176, 42, 42] as [number, number, number])));
    doc.text(`${alpha > 0 ? '+' : ''}${(alpha * 100).toFixed(2)}%`, MARGIN + third * 2 + 12, y + 36);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...GREY);
  doc.text('Portfolio less benchmark, same window', MARGIN + third * 2 + 12, y + 50);

  return y + h + 18;
}

/**
 * The legend, the units note, the engine's caveats and the disclaimer.
 *
 * Drawn last and measured first: if the notes will not fit under the content on
 * the current page they move to a fresh one whole, because a disclaimer split
 * across a page break is a disclaimer half of which gets read.
 */
function drawFooter(doc: jsPDF, y: number, currency: string, notes: string[]): void {
  const units =
    currency === 'INR'
      ? 'Figures in INR, Indian numbering (lakh/crore)'
      : `Figures in ${currencyPrefix(currency).trim() || currency}, thousands separated`;

  const lines: string[] = [
    `Blue text = calculated field   |   Black text = as recorded   |   ${units}`,
    ...notes.map((n) => `Note: ${n}`),
    'This statement is generated for informational purposes only and does not constitute investment advice.',
  ];

  const wrapped = lines.flatMap((l) => doc.splitTextToSize(l, CONTENT_W) as string[]);
  const needed = wrapped.length * 9 + 20;

  let cursor = y + 14;
  if (cursor + needed > PAGE_H - MARGIN) {
    doc.addPage();
    cursor = MARGIN + 10;
  }

  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, cursor - 8, PAGE_W - MARGIN, cursor - 8);

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...GREY);
  for (const line of wrapped) {
    doc.text(line, MARGIN, cursor);
    cursor += 9;
  }
}

/** Page numbers, stamped once at the end when the total is finally known. */
function stampPageNumbers(doc: jsPDF): void {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(`Page ${i} of ${total}`, PAGE_W - MARGIN, PAGE_H - 20, { align: 'right' });
    doc.text('Giriraj Global Consultants', MARGIN, PAGE_H - 20);
  }
}

/** Lays the two panel columns side by side and returns the lower of the two. */
function drawTwoColumns(
  doc: jsPDF,
  y: number,
  leftPanels: Array<{ title: string; lines: Line[] }>,
  rightLines: Line[],
  money: (n: number) => string,
): number {
  let leftY = y;
  for (const panel of leftPanels) {
    leftY = drawPanel(doc, {
      title: panel.title,
      lines: panel.lines,
      x: MARGIN,
      y: leftY + (leftY === y ? 0 : 12),
      width: COL_W,
      money,
    });
  }

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

/**
 * The holdings detail, on its own page.
 *
 * Kept off the summary page for the same reason the workbook keeps it on its
 * own tab: the summary is the page that actually gets read, and a forty-row
 * position table below the headline would bury the six figures the document
 * exists to deliver.
 */
function drawHoldingsPage(doc: jsPDF, asOf: PortfolioAsOf, money: (n: number) => string): void {
  doc.addPage('a4', 'landscape');
  const w = PAGE_H; // landscape: the long edge is now the width

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, w, 34, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...WHITE);
  doc.text(`HOLDINGS AS AT ${fmtDate(new Date(asOf.asOfDate))}`, MARGIN, 22);

  // Ranked by market value: the position that moves the portfolio most is the
  // one a reader looks for first.
  const positions = [...asOf.positions].sort((a, b) => b.marketValue - a.marketValue);

  autoTable(doc, {
    startY: 50,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'plain',
    head: [['Ticker', 'Sector', 'Quantity', 'Avg Cost', 'Close', 'Market Value', 'Cost Basis', 'Unrealized', 'Weight']],
    body: positions.map((p) => [
      p.ticker,
      p.sector || '—',
      p.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 }),
      money(p.averageCost),
      money(p.closingPrice),
      money(p.marketValue),
      money(p.costBasisTotal),
      money(p.unrealizedGain),
      `${(p.weight * 100).toFixed(1)}%`,
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
      `${(positions.reduce((s, p) => s + p.weight, 0) * 100).toFixed(1)}%`,
    ]],
    headStyles: {
      fillColor: STONE,
      textColor: NAVY,
      fontStyle: 'bold',
      fontSize: 8,
      lineColor: HAIRLINE,
      lineWidth: 0.4,
    },
    footStyles: {
      fillColor: GOLD_FILL,
      textColor: NAVY,
      fontStyle: 'bold',
      fontSize: 8.5,
      lineColor: HAIRLINE,
      lineWidth: 0.4,
    },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 4, bottom: 4, left: 5, right: 5 },
      lineColor: HAIRLINE,
      lineWidth: 0.4,
      textColor: INK,
    },
    columnStyles: {
      0: { fontStyle: 'bold' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right', textColor: CALC_BLUE },
      8: { halign: 'right' },
    },
    alternateRowStyles: { fillColor: STONE },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index >= 2) data.cell.styles.halign = 'right';
    },
  });
}

/**
 * The per-account breakdown, on its own page — the household document's
 * equivalent of the holdings page.
 */
function drawMembersPage(doc: jsPDF, fr: FamilyPeriodReturn, money: (n: number) => string): void {
  doc.addPage('a4', 'landscape');
  const w = PAGE_H;

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, w, 34, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...WHITE);
  doc.text(`ACCOUNTS IN ${fr.familyName.toUpperCase()} — ${fr.label}`, MARGIN, 22);

  const members = [...fr.members].sort((a, b) => b.closingValue - a.closingValue);

  autoTable(doc, {
    startY: 50,
    margin: { left: MARGIN, right: MARGIN },
    theme: 'plain',
    head: [['Account', 'Opening', 'Net Flows', 'Closing', 'Gain (net of flows)', 'Return (XIRR)', 'Weight']],
    body: members.map((m) => [
      m.entryDate ? `${m.clientName}  (joined ${fmtDate(new Date(m.entryDate))})` : m.clientName,
      money(m.openingValue),
      money(m.netFlows),
      money(m.closingValue),
      money(m.gain),
      // The account's own standalone figure, so a reader can cross-check it
      // against that client's individual statement. Its absence is stated as
      // such rather than shown as a zero.
      m.returnPct === null ? 'Not available' : `${m.returnPct > 0 ? '+' : ''}${(m.returnPct * 100).toFixed(2)}%`,
      `${(m.weight * 100).toFixed(1)}%`,
    ]),
    foot: [[
      'HOUSEHOLD',
      money(fr.openingValue),
      money(fr.netFlows),
      money(fr.closingValue),
      money(fr.closingValue - fr.openingValue - fr.netFlows),
      fr.returnPct === null ? 'Not available' : `${fr.returnPct > 0 ? '+' : ''}${(fr.returnPct * 100).toFixed(2)}%`,
      '100.0%',
    ]],
    headStyles: {
      fillColor: STONE,
      textColor: NAVY,
      fontStyle: 'bold',
      fontSize: 8,
      lineColor: HAIRLINE,
      lineWidth: 0.4,
    },
    footStyles: {
      fillColor: GOLD_FILL,
      textColor: NAVY,
      fontStyle: 'bold',
      fontSize: 8.5,
      lineColor: HAIRLINE,
      lineWidth: 0.4,
    },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: { top: 4, bottom: 4, left: 5, right: 5 },
      lineColor: HAIRLINE,
      lineWidth: 0.4,
      textColor: INK,
    },
    columnStyles: {
      0: { fontStyle: 'bold' },
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right', textColor: CALC_BLUE },
      5: { halign: 'right', textColor: CALC_BLUE },
      6: { halign: 'right' },
    },
    alternateRowStyles: { fillColor: STONE },
    didParseCell: (data) => {
      if (data.section === 'head' && data.column.index >= 1) data.cell.styles.halign = 'right';
    },
  });

  // The household total is not the sum of the member returns, and the page that
  // shows both columns is exactly where that has to be said.
  const endY = (doc as any).lastAutoTable.finalY as number;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(...GREY);
  doc.text(
    'The household return is solved once over the combined flows of every account above. It is not the average, ' +
      'nor the weighted average, of the per-account returns in this table.',
    MARGIN,
    endY + 14,
  );
}

/** Builds the client period statement as a PDF document. */
export function buildPeriodPerformancePdf(
  clientName: string,
  pr: PeriodReturn,
  asOf: PortfolioAsOf | null,
  currency: string,
): jsPDF {
  const doc = newDoc();
  doc.setProperties({
    title: `Performance Summary — ${clientName} — ${pr.label}`,
    author: 'Giriraj Global Consultants',
    subject: 'Performance Summary',
  });

  const money = moneyFormatter(currency);

  let y = drawBanner(doc);
  y = drawIdentity(doc, clientName, new Date(pr.to), periodTimeFrameLabel(pr), y);
  y = drawHeadline(doc, {
    y,
    label: `Return — ${pr.label}`,
    returnPct: pr.returnPct,
    returnReason: pr.returnReason,
    benchmarkName: pr.benchmark?.name ?? pr.benchmark?.code ?? null,
    benchmarkPct: pr.benchmark?.xirr ?? null,
    alpha: pr.alpha,
  });
  y = drawTwoColumns(doc, y, periodLeftPanels(pr, asOf), periodRightLines(pr), money);
  drawFooter(doc, y, currency, periodNotes(pr, asOf));

  if (asOf && asOf.positions.length) drawHoldingsPage(doc, asOf, money);

  stampPageNumbers(doc);
  return doc;
}

/** Builds the household period statement as a PDF document. */
export function buildFamilyPerformancePdf(fr: FamilyPeriodReturn, currency: string): jsPDF {
  const doc = newDoc();
  doc.setProperties({
    title: `Performance Summary — ${fr.familyName} (household) — ${fr.label}`,
    author: 'Giriraj Global Consultants',
    subject: 'Household Performance Summary',
  });

  const money = moneyFormatter(currency);

  let y = drawBanner(doc);
  y = drawIdentity(
    doc,
    `${fr.familyName} (household)`,
    new Date(fr.to),
    familyTimeFrameLabel(fr),
    y,
  );
  y = drawHeadline(doc, {
    y,
    label: `Household return — ${fr.label}`,
    returnPct: fr.returnPct,
    returnReason: fr.returnReason,
    benchmarkName: fr.benchmark?.name ?? fr.benchmark?.code ?? null,
    benchmarkPct: fr.benchmark?.xirr ?? null,
    alpha: fr.alpha,
  });
  y = drawTwoColumns(doc, y, familyLeftPanels(fr), familyRightLines(fr), money);
  drawFooter(doc, y, currency, familyNotes(fr));

  if (fr.members.length) drawMembersPage(doc, fr, money);

  stampPageNumbers(doc);
  return doc;
}

/**
 * Filenames carry the WINDOW as well as the date.
 *
 * Two statements for one client struck on the same day for different periods
 * are different documents, and a name that collapses them into one is how a
 * Q1 statement ends up filed as the Q2 one.
 */
function fileSlug(name: string, label: string, to: string): string {
  const subject = name.replace(/\s+/g, '_').toLowerCase();
  const period = label.replace(/[^\w]+/g, '-').toLowerCase();
  return `${subject}-performance-${period}-${to.slice(0, 10)}`;
}

export function downloadPeriodPerformancePdf(
  clientName: string,
  pr: PeriodReturn,
  asOf: PortfolioAsOf | null,
  currency: string,
): void {
  const doc = buildPeriodPerformancePdf(clientName, pr, asOf, currency);
  doc.save(`${fileSlug(clientName, pr.label, pr.to)}.pdf`);
}

export function downloadFamilyPerformancePdf(fr: FamilyPeriodReturn, currency: string): void {
  const doc = buildFamilyPerformancePdf(fr, currency);
  doc.save(`${fileSlug(`${fr.familyName}-household`, fr.label, fr.to)}.pdf`);
}
