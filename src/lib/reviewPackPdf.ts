import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { PeriodReturn } from './portfolio-history.api';
import { analyseRisk, type RiskPosition } from './riskReportPdf';
import {
  CONTENT_W,
  COL_W,
  DANGER,
  drawBanner,
  drawFooter,
  drawIdentity,
  drawSectionTitle,
  fileSlug,
  fmtDate,
  GOLD,
  GOLD_FILL,
  GREY,
  GUTTER,
  HAIRLINE,
  INK,
  MARGIN,
  moneyFormatter,
  NAVY,
  newDoc,
  PAGE_H,
  PAGE_W,
  pct,
  stampPageNumbers,
  STONE,
  SUCCESS,
  WHITE,
} from './pdfChrome';

/**
 * The Client Review Pack — the document that goes in front of the client at the
 * quarterly meeting.
 *
 * How it differs from the Performance Summary, which also reports a return:
 * the Performance Summary is an evidentiary document, built to be checked
 * figure-by-figure against the workbook an adviser holds. This is the
 * conversational one. It leads with the return, then answers the three
 * questions a client actually asks next — what am I holding, how is it spread,
 * and what changed — and carries the adviser's own commentary, which no other
 * document in the app does.
 *
 * It does not recompute anything. The return, the benchmark and the alpha are
 * the `PeriodReturn` the Performance page already fetched; the allocation and
 * concentration figures come from `analyseRisk`, the same function behind the
 * Risk & Exposure Report. A review pack that derived its own numbers would
 * eventually quote a different return from the statement sent the same week,
 * and the client would be right to ask which one was true.
 */

export interface ReviewPackInput {
  subject: string;
  subjectKind: 'client' | 'family';
  currency: string;
  asOf: Date;
  /**
   * The period's return, straight from the Performance page's own fetch.
   * Null when the mandate has no measurable window yet — the pack still prints,
   * because a new client's first review is a real meeting, and it says so
   * rather than showing a fabricated 0%.
   */
  periodReturn: PeriodReturn | null;
  positions: RiskPosition[];
  cashBalance: number;
  /** Adviser commentary, free text. Printed verbatim when present. */
  commentary?: string;
  memberCount?: number;
}

/** How many positions the holdings section lists before it truncates. */
const HOLDINGS_LIMIT = 25;

/**
 * The headline band: the period return, the benchmark, and the difference.
 *
 * Given the width of the page because this is the figure the meeting opens on.
 * A null return is printed as "Not available" with its reason, never as 0.0% —
 * a zero would read as "we measured this and it was flat", which is a different
 * claim from "we could not measure it", and a false one.
 */
function drawReturnBand(
  doc: jsPDF,
  y: number,
  pr: PeriodReturn | null,
  money: (n: number) => string,
): number {
  const h = 72;
  doc.setFillColor(...STONE);
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.5);
  doc.rect(MARGIN, y, CONTENT_W, h, 'FD');

  const third = CONTENT_W / 3;

  const caption = (x: number, text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(text.toUpperCase(), x, y + 18);
  };

  caption(MARGIN + 12, pr ? `Return — ${pr.label}` : 'Return');

  if (!pr || pr.returnPct === null) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...GREY);
    doc.text('Not available', MARGIN + 12, y + 42);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    const reason =
      pr?.returnReason ?? 'No measurable period yet for this mandate.';
    doc.text(doc.splitTextToSize(reason, third - 22).slice(0, 2), MARGIN + 12, y + 54);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.setTextColor(...(pr.returnPct >= 0 ? NAVY : DANGER));
    doc.text(`${pr.returnPct > 0 ? '+' : ''}${(pr.returnPct * 100).toFixed(2)}%`, MARGIN + 12, y + 44);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    // Naming the method matters on a client document: a money-weighted return
    // answers "how did MY money do", and a client comparing it to an index's
    // point-to-point figure is comparing two different measurements.
    doc.text('Money-weighted (XIRR), flow-adjusted', MARGIN + 12, y + 58);
  }

  doc.setDrawColor(...HAIRLINE);
  doc.line(MARGIN + third, y + 10, MARGIN + third, y + h - 10);
  doc.line(MARGIN + third * 2, y + 10, MARGIN + third * 2, y + h - 10);

  const cell = (i: number, label: string, value: string, sub: string, tone?: [number, number, number]) => {
    const x = MARGIN + third * i + 12;
    caption(x, label);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.setTextColor(...(tone ?? INK));
    doc.text(value, x, y + 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(doc.splitTextToSize(sub, third - 24).slice(0, 2), x, y + 56);
  };

  const bench = pr?.benchmark ?? null;
  const benchPct = bench?.interim ?? bench?.xirr ?? null;

  cell(
    1,
    'Benchmark',
    benchPct === null ? '—' : `${benchPct > 0 ? '+' : ''}${(benchPct * 100).toFixed(2)}%`,
    bench?.name ?? bench?.code ?? 'No benchmark configured',
  );

  const alpha = pr?.alpha ?? null;
  cell(
    2,
    'Difference',
    alpha === null ? '—' : `${alpha > 0 ? '+' : ''}${(alpha * 100).toFixed(2)}%`,
    alpha === null ? 'Needs both figures above' : alpha >= 0 ? 'Ahead of the benchmark' : 'Behind the benchmark',
    alpha === null ? undefined : alpha >= 0 ? SUCCESS : DANGER,
  );

  return y + h + 18;
}

/** The money movement panel — what the portfolio was worth and what moved. */
function drawValuePanel(
  doc: jsPDF,
  y: number,
  pr: PeriodReturn | null,
  portfolioValue: number,
  cashBalance: number,
  money: (n: number) => string,
): number {
  const rows: Array<[string, string, boolean]> = [];

  if (pr) {
    rows.push(['Opening value', money(pr.openingValue), false]);
    rows.push([
      pr.netFlows >= 0 ? 'Net contributions' : 'Net withdrawals',
      money(Math.abs(pr.netFlows)),
      false,
    ]);
    // Gain is stated as what is left after removing the money the client put
    // in, which is the only reading of "gain" a client should be shown. A
    // closing-minus-opening figure counts their own deposit as performance.
    rows.push([
      'Investment gain / loss',
      money(pr.closingValue - pr.openingValue - pr.netFlows),
      false,
    ]);
    rows.push(['Closing value', money(pr.closingValue), true]);
  } else {
    rows.push(['Portfolio value', money(portfolioValue), true]);
  }
  rows.push(['Of which cash', money(cashBalance), false]);

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: PAGE_W - MARGIN - COL_W },
    tableWidth: COL_W,
    theme: 'plain',
    head: [['PORTFOLIO VALUE', '']],
    body: rows.map(([l, v]) => [l, v]),
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
    },
    columnStyles: {
      0: { cellWidth: COL_W * 0.58, textColor: GREY },
      1: { cellWidth: COL_W * 0.42, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const row = rows[data.row.index];
      if (row?.[2]) {
        data.cell.styles.fillColor = GOLD_FILL;
        data.cell.styles.fontStyle = 'bold';
        if (data.column.index === 0) data.cell.styles.textColor = NAVY;
      } else if (data.row.index % 2 === 0) {
        data.cell.styles.fillColor = STONE;
      }
    },
  });

  return (doc as any).lastAutoTable.finalY as number;
}

/** The allocation panel — top sectors by weight, beside the value panel. */
function drawAllocationPanel(
  doc: jsPDF,
  y: number,
  sectors: Array<{ label: string; weight: number }>,
  cashWeight: number,
): number {
  const rows = sectors.slice(0, 6).map((s) => [s.label, pct(s.weight)]);
  if (cashWeight > 0) rows.push(['Cash & equivalents', pct(cashWeight)]);
  if (sectors.length > 6) {
    const rest = sectors.slice(6).reduce((s, x) => s + x.weight, 0);
    rows.push([`Other (${sectors.length - 6} sectors)`, pct(rest)]);
  }

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN + COL_W + GUTTER, right: MARGIN },
    tableWidth: COL_W,
    theme: 'plain',
    head: [['ALLOCATION', '']],
    body: rows.length ? rows : [['No open positions', '—']],
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
    },
    columnStyles: {
      0: { cellWidth: COL_W * 0.66, textColor: GREY },
      1: { cellWidth: COL_W * 0.34, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index % 2 === 0) {
        data.cell.styles.fillColor = STONE;
      }
    },
  });

  return (doc as any).lastAutoTable.finalY as number;
}

/**
 * The adviser's commentary.
 *
 * Printed verbatim and unstyled beyond wrapping — it is the one part of the
 * pack a human wrote, and reformatting someone's sentences is how a caveat they
 * chose deliberately gets softened.
 */
function drawCommentary(doc: jsPDF, y: number, commentary: string): number {
  const wrapped = doc.splitTextToSize(commentary.trim(), CONTENT_W - 24) as string[];
  const boxH = wrapped.length * 11 + 24;

  let cursor = drawSectionTitle(doc, "Adviser's commentary", y, boxH + 20);

  doc.setFillColor(...STONE);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.rect(MARGIN, cursor, CONTENT_W, boxH, 'FD');
  // A gold spine on the left marks it as quoted human text rather than a
  // generated block, matching the accent on the section rules.
  doc.setFillColor(...GOLD);
  doc.rect(MARGIN, cursor, 2.5, boxH, 'F');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(wrapped, MARGIN + 14, cursor + 16);

  return cursor + boxH + 16;
}

/** The holdings table — the client's positions, largest first. */
function drawHoldings(
  doc: jsPDF,
  y: number,
  positions: Array<RiskPosition & { weight: number }>,
  money: (n: number) => string,
): number {
  if (!positions.length) return y;

  const shown = positions.slice(0, HOLDINGS_LIMIT);
  const hidden = positions.length - shown.length;

  let cursor = drawSectionTitle(doc, 'Holdings', y, 120);

  autoTable(doc, {
    startY: cursor,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: CONTENT_W,
    theme: 'plain',
    head: [['Symbol', 'Name', 'Sector', 'Quantity', 'Value', 'Weight', 'Return']],
    body: shown.map((p) => [
      p.symbol,
      p.name,
      p.sector || 'Unclassified',
      p.quantity.toLocaleString('en-US', { maximumFractionDigits: 2 }),
      money(p.currentValue),
      pct(p.weight),
      `${p.plPercent >= 0 ? '+' : ''}${p.plPercent.toFixed(1)}%`,
    ]),
    headStyles: {
      fillColor: NAVY,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: { top: 4.5, bottom: 4.5, left: 5, right: 5 },
    },
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 },
      lineColor: HAIRLINE,
      lineWidth: 0.3,
      textColor: INK,
      overflow: 'ellipsize',
    },
    columnStyles: {
      0: { cellWidth: CONTENT_W * 0.11, fontStyle: 'bold' },
      1: { cellWidth: CONTENT_W * 0.28 },
      2: { cellWidth: CONTENT_W * 0.17, textColor: GREY },
      3: { cellWidth: CONTENT_W * 0.11, halign: 'right' },
      4: { cellWidth: CONTENT_W * 0.15, halign: 'right' },
      5: { cellWidth: CONTENT_W * 0.09, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: CONTENT_W * 0.09, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const p = shown[data.row.index];
      if (!p) return;
      if (data.column.index === 6) {
        data.cell.styles.textColor = p.pl >= 0 ? SUCCESS : DANGER;
      }
      if (data.row.index % 2 === 0) data.cell.styles.fillColor = STONE;
    },
  });

  cursor = (doc as any).lastAutoTable.finalY as number;

  // Truncation is stated rather than silent: a client counting their positions
  // against this list must not conclude the missing ones were sold.
  if (hidden > 0) {
    cursor += 10;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(
      `${hidden} further position${hidden === 1 ? '' : 's'} held below the largest ${HOLDINGS_LIMIT} by weight are not listed here. The Holdings Statement lists every position in full.`,
      MARGIN,
      cursor,
    );
    cursor += 10;
  }

  return cursor + 8;
}

/** Builds the Client Review Pack as a PDF document. */
export function buildReviewPackPdf(input: ReviewPackInput): jsPDF {
  const analysis = analyseRisk({
    subject: input.subject,
    subjectKind: input.subjectKind,
    currency: input.currency,
    asOf: input.asOf,
    positions: input.positions,
    cashBalance: input.cashBalance,
    memberCount: input.memberCount,
  });

  const doc = newDoc();
  doc.setProperties({
    title: `Client Review Pack — ${input.subject}${
      input.periodReturn ? ` — ${input.periodReturn.label}` : ''
    }`,
    author: 'Giriraj Global Consultants',
    subject: 'Client Review Pack',
  });

  const money = moneyFormatter(input.currency);
  const pr = input.periodReturn;

  let y = drawBanner(doc, 'Client Review Pack');

  const subject = input.subjectKind === 'family' ? `${input.subject} (household)` : input.subject;
  const window = pr
    ? `${pr.label} · ${fmtDate(pr.from)} to ${fmtDate(pr.to)}${
        pr.openPeriod ? ' (period still open)' : ''
      }${
        pr.clampedToInception
          ? ` · window opened at inception, ${pr.daysClamped} day${
              pr.daysClamped === 1 ? '' : 's'
            } short of the full period`
          : ''
      }`
    : 'Review as at the date above — no closed performance period yet';

  y = drawIdentity(doc, subject, input.asOf, window, y);
  y = drawReturnBand(doc, y, pr, money);

  // The two panels sit side by side, and the page continues below the lower of
  // the two — a value panel with four rows and an allocation panel with eight
  // do not end at the same height.
  const valueY = drawValuePanel(doc, y, pr, analysis.portfolioValue, input.cashBalance, money);
  const allocY = drawAllocationPanel(doc, y, analysis.sectors, analysis.cashWeight);
  y = Math.max(valueY, allocY) + 16;

  if (input.commentary && input.commentary.trim()) {
    y = drawCommentary(doc, y, input.commentary);
  }

  y = drawHoldings(doc, y, analysis.positions, money);

  drawFooter(doc, y, input.currency, reviewNotes(input, analysis), { legend: false });
  stampPageNumbers(doc);
  return doc;
}

/** Only the caveats that actually bear on this pack's figures. */
function reviewNotes(input: ReviewPackInput, analysis: ReturnType<typeof analyseRisk>): string[] {
  const notes: string[] = [];
  const pr = input.periodReturn;

  if (pr?.openPeriod) {
    notes.push(
      'This period has not closed. The return above is measured to today and will change before the period ends.',
    );
  }

  if (pr?.clampedToInception) {
    notes.push(
      `The mandate opened part-way into this period, so the return covers ${pr.periodDays} days rather than the full window and is not directly comparable to a full-period figure.`,
    );
  }

  if (pr && pr.returnPct !== null) {
    notes.push(
      'Returns are money-weighted (XIRR) and adjusted for deposits and withdrawals, so money you added during the period is not counted as investment performance.',
    );
  }

  if (input.subjectKind === 'family') {
    notes.push(
      'Household figures are computed over the combined cash flows of every member account, not as an average of the individual account returns.',
    );
  }

  if (analysis.cashWeight > 0.15) {
    notes.push(
      `${pct(analysis.cashWeight)} of the portfolio is held in cash, which does not participate in market returns.`,
    );
  }

  return notes;
}

export function downloadReviewPackPdf(input: ReviewPackInput): void {
  const doc = buildReviewPackPdf(input);
  const period = input.periodReturn ? `review-${input.periodReturn.label.replace(/[^\w]+/g, '-').toLowerCase()}` : 'review';
  doc.save(`${fileSlug(input.subject, period, input.asOf)}.pdf`);
}
