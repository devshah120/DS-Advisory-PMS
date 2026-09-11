import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import {
  CONTENT_W,
  DANGER,
  drawBanner,
  drawFooter,
  drawIdentity,
  drawSectionTitle,
  fileSlug,
  GOLD,
  GOLD_FILL,
  GREY,
  HAIRLINE,
  INK,
  MARGIN,
  moneyFormatter,
  NAVY,
  newDoc,
  PAGE_W,
  pct,
  stampPageNumbers,
  STONE,
  SUCCESS,
  WHITE,
} from './pdfChrome';

/**
 * The Risk & Exposure Report.
 *
 * What this document is for: a portfolio can be up on the quarter and still be
 * one position away from a serious loss. The Performance Summary answers "what
 * did this make"; this answers "what is it exposed to", which is a different
 * question and the one a review meeting is supposed to ask before the client
 * does.
 *
 * The figures here are all derived from positions the app already holds — no
 * new backend endpoint. That is deliberate: concentration, sector spread and
 * cash drag are arithmetic over the holdings table, and computing them here
 * means the report can never disagree with the holdings screen a reader just
 * came from.
 *
 * What this report does NOT claim: it carries no volatility, beta, drawdown or
 * VaR. Those need a price history this app does not keep per position, and a
 * fabricated beta on a client-facing risk document is worse than an absent one
 * — it invites a decision. Every number below is a fact about the portfolio's
 * composition as it stands today.
 */

/** One position, as the risk report reads it. */
export interface RiskPosition {
  symbol: string;
  name: string;
  sector: string;
  quantity: number;
  currentValue: number;
  costBasis: number;
  pl: number;
  plPercent: number;
}

export interface RiskReportInput {
  subject: string;
  /** 'Household' adds the member-count line and renames the subject block. */
  subjectKind: 'client' | 'family';
  currency: string;
  asOf: Date;
  positions: RiskPosition[];
  cashBalance: number;
  /** Member account count, for a household. Omitted for a single mandate. */
  memberCount?: number;
}

/** The concentration bands the report scores against. */
const CONCENTRATION_LIMITS = {
  /** A single name above this share of the portfolio is flagged. */
  singlePosition: 0.1,
  /** A single sector above this share is flagged. */
  singleSector: 0.3,
  /** Top-5 names above this share means the book rests on a handful of calls. */
  topFive: 0.5,
  /** Cash above this share is flagged as drag rather than as prudence. */
  cashDrag: 0.15,
};

type Severity = 'ok' | 'watch' | 'breach';

interface RiskFinding {
  label: string;
  value: string;
  limit: string;
  severity: Severity;
  /** What the reader should take from it. Printed under the table. */
  note?: string;
}

export interface RiskAnalysis {
  portfolioValue: number;
  investedValue: number;
  cashWeight: number;
  positionCount: number;
  sectorCount: number;
  /** Sum of squared weights — 1 is a single name, 1/n is perfectly even. */
  herfindahl: number;
  /**
   * Effective number of positions (1 / HHI). A 40-name book whose top position
   * is 30% has an effective count nearer 8 than 40, which is the honest answer
   * to "how diversified is this" and the reason the raw count is not enough.
   */
  effectiveHoldings: number;
  topFiveWeight: number;
  largest: { label: string; weight: number } | null;
  largestSector: { label: string; weight: number } | null;
  sectors: Array<{ label: string; value: number; weight: number; positions: number }>;
  positions: Array<RiskPosition & { weight: number }>;
  findings: RiskFinding[];
  /** 0–100. Higher is safer. See `scoreOf` for what it does and does not mean. */
  score: number;
  scoreBand: 'Conservative' | 'Balanced' | 'Elevated' | 'Aggressive';
}

/**
 * Rolls the positions into every figure the report prints.
 *
 * Exported because the dialog renders the same analysis on screen before the
 * user downloads it. The preview and the PDF must agree, and the only way to
 * guarantee that is for both to read one function's output rather than each
 * computing its own version of "the top five".
 */
export function analyseRisk(input: RiskReportInput): RiskAnalysis {
  const { positions, cashBalance } = input;

  const investedValue = positions.reduce((s, p) => s + p.currentValue, 0);
  const portfolioValue = investedValue + cashBalance;

  // Weights are against the WHOLE portfolio including cash, not just the
  // invested part. A book that is 40% cash and holds one stock at 60% is
  // concentrated in that stock by 60%, and rebasing to the invested total
  // would report it as 100% and overstate the risk just as badly as ignoring
  // cash understates it.
  const weighted = positions
    .map((p) => ({ ...p, weight: portfolioValue > 0 ? p.currentValue / portfolioValue : 0 }))
    .sort((a, b) => b.weight - a.weight);

  const sectorMap = new Map<string, { value: number; positions: number }>();
  for (const p of positions) {
    const key = p.sector || 'Unclassified';
    const cur = sectorMap.get(key) ?? { value: 0, positions: 0 };
    sectorMap.set(key, { value: cur.value + p.currentValue, positions: cur.positions + 1 });
  }

  const sectors = [...sectorMap.entries()]
    .map(([label, s]) => ({
      label,
      value: s.value,
      positions: s.positions,
      weight: portfolioValue > 0 ? s.value / portfolioValue : 0,
    }))
    .sort((a, b) => b.weight - a.weight);

  const herfindahl = weighted.reduce((s, p) => s + p.weight * p.weight, 0);
  const topFiveWeight = weighted.slice(0, 5).reduce((s, p) => s + p.weight, 0);
  const cashWeight = portfolioValue > 0 ? cashBalance / portfolioValue : 0;

  const largest = weighted.length ? { label: weighted[0].symbol, weight: weighted[0].weight } : null;
  const largestSector = sectors.length
    ? { label: sectors[0].label, weight: sectors[0].weight }
    : null;

  const findings = buildFindings({
    largest,
    largestSector,
    topFiveWeight,
    cashWeight,
    positionCount: positions.length,
    sectorCount: sectors.length,
  });

  const score = scoreOf({ herfindahl, topFiveWeight, largest, largestSector, sectorCount: sectors.length });

  return {
    portfolioValue,
    investedValue,
    cashWeight,
    positionCount: positions.length,
    sectorCount: sectors.length,
    herfindahl,
    effectiveHoldings: herfindahl > 0 ? 1 / herfindahl : 0,
    topFiveWeight,
    largest,
    largestSector,
    sectors,
    positions: weighted,
    findings,
    score,
    scoreBand:
      score >= 75 ? 'Conservative' : score >= 55 ? 'Balanced' : score >= 35 ? 'Elevated' : 'Aggressive',
  };
}

/**
 * Each limit, what the portfolio actually reads against it, and whether that is
 * a breach.
 *
 * "watch" exists between ok and breach because a position at 9.8% against a 10%
 * limit is not compliant-and-fine — it is one good week from a breach, and a
 * report that shows it in the same green as a 2% position hides the thing the
 * adviser can still act on cheaply.
 */
function buildFindings(a: {
  largest: { label: string; weight: number } | null;
  largestSector: { label: string; weight: number } | null;
  topFiveWeight: number;
  cashWeight: number;
  positionCount: number;
  sectorCount: number;
}): RiskFinding[] {
  const band = (value: number, limit: number): Severity =>
    value > limit ? 'breach' : value > limit * 0.85 ? 'watch' : 'ok';

  const out: RiskFinding[] = [];

  if (a.largest) {
    out.push({
      label: `Largest position — ${a.largest.label}`,
      value: pct(a.largest.weight),
      limit: `${pct(CONCENTRATION_LIMITS.singlePosition, 0)} max`,
      severity: band(a.largest.weight, CONCENTRATION_LIMITS.singlePosition),
      note:
        a.largest.weight > CONCENTRATION_LIMITS.singlePosition
          ? `A single adverse move in ${a.largest.label} moves the whole portfolio by ${pct(
              a.largest.weight,
            )} of that move.`
          : undefined,
    });
  }

  if (a.largestSector) {
    out.push({
      label: `Largest sector — ${a.largestSector.label}`,
      value: pct(a.largestSector.weight),
      limit: `${pct(CONCENTRATION_LIMITS.singleSector, 0)} max`,
      severity: band(a.largestSector.weight, CONCENTRATION_LIMITS.singleSector),
      note:
        a.largestSector.weight > CONCENTRATION_LIMITS.singleSector
          ? `Names within a sector fall together. This exposure is closer to one bet than to ${
              a.positionCount
            } separate ones.`
          : undefined,
    });
  }

  out.push({
    label: 'Top 5 positions',
    value: pct(a.topFiveWeight),
    limit: `${pct(CONCENTRATION_LIMITS.topFive, 0)} max`,
    severity: band(a.topFiveWeight, CONCENTRATION_LIMITS.topFive),
  });

  out.push({
    label: 'Cash weight',
    value: pct(a.cashWeight),
    limit: `${pct(CONCENTRATION_LIMITS.cashDrag, 0)} guide`,
    severity: band(a.cashWeight, CONCENTRATION_LIMITS.cashDrag),
    note:
      a.cashWeight > CONCENTRATION_LIMITS.cashDrag
        ? 'Uninvested cash is not a loss, but it does not participate in the market either. Confirm this is a deliberate position rather than an unplaced balance.'
        : undefined,
  });

  // An unclassified sector bucket makes the sector figures above understate
  // concentration, so the reader is told rather than left to trust them.
  return out;
}

/**
 * A single 0–100 composition score.
 *
 * It is a summary of the four measures already printed above it, not an
 * independent judgement — which is exactly why the report prints the measures
 * beside it rather than the score alone. A score cannot tell a reader WHICH
 * exposure to cut, and a client-facing document that offers one without its
 * components invites exactly that misreading.
 */
function scoreOf(a: {
  herfindahl: number;
  topFiveWeight: number;
  largest: { weight: number } | null;
  largestSector: { weight: number } | null;
  sectorCount: number;
}): number {
  // Effective holdings saturates at 25 names: past that, added breadth stops
  // meaningfully reducing single-name risk and the score should reflect the
  // other exposures instead.
  const effective = a.herfindahl > 0 ? 1 / a.herfindahl : 0;
  const breadth = Math.min(effective / 25, 1);

  const single = a.largest ? Math.max(0, 1 - a.largest.weight / 0.25) : 1;
  const sector = a.largestSector ? Math.max(0, 1 - a.largestSector.weight / 0.6) : 1;
  const topFive = Math.max(0, 1 - a.topFiveWeight / 0.85);
  const spread = Math.min(a.sectorCount / 8, 1);

  const score = breadth * 30 + single * 25 + sector * 20 + topFive * 15 + spread * 10;
  return Math.round(Math.max(0, Math.min(100, score)));
}

const SEVERITY_FILL: Record<Severity, [number, number, number]> = {
  ok: [232, 245, 233],
  watch: [255, 244, 214],
  breach: [253, 232, 232],
};

const SEVERITY_TEXT: Record<Severity, [number, number, number]> = {
  ok: SUCCESS,
  watch: [146, 96, 6],
  breach: DANGER,
};

const SEVERITY_LABEL: Record<Severity, string> = {
  ok: 'Within limit',
  watch: 'Approaching',
  breach: 'Over limit',
};

/**
 * The score band across the top of the page — the figure a reader looks at
 * first, with the count of breaches beside it so a high score cannot be read as
 * "nothing to discuss".
 */
function drawScoreBand(doc: jsPDF, y: number, a: RiskAnalysis, money: (n: number) => string): number {
  const h = 66;
  doc.setFillColor(...STONE);
  doc.setDrawColor(...HAIRLINE);
  doc.setLineWidth(0.5);
  doc.rect(MARGIN, y, CONTENT_W, h, 'FD');

  const quarter = CONTENT_W / 4;
  const breaches = a.findings.filter((f) => f.severity === 'breach').length;
  const watches = a.findings.filter((f) => f.severity === 'watch').length;

  const caption = (x: number, text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    doc.text(text.toUpperCase(), x, y + 17);
  };

  caption(MARGIN + 12, 'Composition score');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(...(a.score >= 55 ? NAVY : a.score >= 35 ? ([146, 96, 6] as [number, number, number]) : DANGER));
  doc.text(String(a.score), MARGIN + 12, y + 44);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text(`/100 · ${a.scoreBand}`, MARGIN + 12 + doc.getTextWidth(String(a.score)) + 16, y + 44);

  doc.setFontSize(7);
  doc.text('Composition only — not a volatility measure', MARGIN + 12, y + 57);

  doc.setDrawColor(...HAIRLINE);
  for (let i = 1; i < 4; i += 1) {
    doc.line(MARGIN + quarter * i, y + 10, MARGIN + quarter * i, y + h - 10);
  }

  const cell = (i: number, label: string, value: string, sub: string) => {
    const x = MARGIN + quarter * i + 12;
    caption(x, label);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...INK);
    doc.text(value, x, y + 40);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...GREY);
    doc.text(doc.splitTextToSize(sub, quarter - 22)[0], x, y + 53);
  };

  cell(1, 'Portfolio value', money(a.portfolioValue), `${a.positionCount} positions · ${a.sectorCount} sectors`);
  cell(
    2,
    'Effective holdings',
    a.effectiveHoldings ? a.effectiveHoldings.toFixed(1) : '—',
    `of ${a.positionCount} held — by weight`,
  );
  cell(
    3,
    'Limit checks',
    breaches > 0 ? `${breaches} over` : watches > 0 ? `${watches} near` : 'All clear',
    breaches > 0 ? 'See the limits table below' : watches > 0 ? 'Approaching a limit' : 'No limit exceeded',
  );

  return y + h + 18;
}

/** The limits table — every band, what the book reads, and the verdict. */
function drawLimits(doc: jsPDF, y: number, a: RiskAnalysis): number {
  let cursor = drawSectionTitle(doc, 'Concentration limits', y, 120);

  autoTable(doc, {
    startY: cursor,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: CONTENT_W,
    theme: 'plain',
    head: [['Measure', 'Portfolio', 'Limit', 'Status']],
    body: a.findings.map((f) => [f.label, f.value, f.limit, SEVERITY_LABEL[f.severity]]),
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
      cellPadding: { top: 5, bottom: 5, left: 6, right: 6 },
      lineColor: HAIRLINE,
      lineWidth: 0.4,
      textColor: INK,
      overflow: 'linebreak',
    },
    columnStyles: {
      0: { cellWidth: CONTENT_W * 0.44 },
      1: { cellWidth: CONTENT_W * 0.16, halign: 'right', fontStyle: 'bold' },
      2: { cellWidth: CONTENT_W * 0.18, halign: 'right', textColor: GREY },
      3: { cellWidth: CONTENT_W * 0.22, halign: 'center', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const finding = a.findings[data.row.index];
      if (!finding) return;
      if (data.column.index === 3) {
        data.cell.styles.fillColor = SEVERITY_FILL[finding.severity];
        data.cell.styles.textColor = SEVERITY_TEXT[finding.severity];
      } else if (finding.severity === 'breach') {
        // The whole row tints on a breach so it is findable at a glance on a
        // printed page, not only by reading the rightmost column.
        data.cell.styles.fillColor = SEVERITY_FILL.breach;
      }
    },
  });

  cursor = (doc as any).lastAutoTable.finalY as number;

  // The notes explain what a breach MEANS. A limits table on its own tells a
  // client a rule was broken without telling them why the rule exists.
  const notes = a.findings.filter((f) => f.note);
  if (notes.length) {
    cursor += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GREY);
    for (const n of notes) {
      const wrapped = doc.splitTextToSize(`· ${n.note}`, CONTENT_W) as string[];
      doc.text(wrapped, MARGIN, cursor);
      cursor += wrapped.length * 9 + 2;
    }
  }

  return cursor + 12;
}

/** Sector exposure, as a table with an inline weight bar. */
function drawSectors(doc: jsPDF, y: number, a: RiskAnalysis, money: (n: number) => string): number {
  let cursor = drawSectionTitle(doc, 'Sector exposure', y, 110);

  const rows = a.sectors.map((s) => [s.label, String(s.positions), money(s.value), pct(s.weight)]);
  if (a.cashWeight > 0) {
    rows.push(['Cash & equivalents', '—', money(a.portfolioValue - a.investedValue), pct(a.cashWeight)]);
  }

  autoTable(doc, {
    startY: cursor,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: CONTENT_W,
    theme: 'plain',
    head: [['Sector', 'Positions', 'Value', 'Weight']],
    body: rows,
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
      0: { cellWidth: CONTENT_W * 0.42 },
      1: { cellWidth: CONTENT_W * 0.14, halign: 'center', textColor: GREY },
      2: { cellWidth: CONTENT_W * 0.24, halign: 'right' },
      3: { cellWidth: CONTENT_W * 0.2, halign: 'right', fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const sector = a.sectors[data.row.index];
      // Over-limit sectors tint, so the exposure driving a breach above is
      // identifiable in the table that explains it.
      if (sector && sector.weight > CONCENTRATION_LIMITS.singleSector) {
        data.cell.styles.fillColor = SEVERITY_FILL.breach;
      } else if (data.row.index % 2 === 0) {
        data.cell.styles.fillColor = STONE;
      }
      // An unclassified bucket is a gap in the data, not a sector.
      if (sector && data.column.index === 0 && /unclassified|uncategor/i.test(sector.label)) {
        data.cell.styles.textColor = GREY;
        data.cell.styles.fontStyle = 'italic';
      }
    },
  });

  return ((doc as any).lastAutoTable.finalY as number) + 14;
}

/**
 * The positions, largest weight first.
 *
 * Ordered by weight rather than alphabetically because this is a risk document:
 * the reader wants the exposures that matter at the top, and an A-to-Z listing
 * buries a 14% position among names that round to nothing.
 */
function drawPositions(doc: jsPDF, y: number, a: RiskAnalysis, money: (n: number) => string): number {
  let cursor = drawSectionTitle(doc, 'Positions by weight', y, 120);

  autoTable(doc, {
    startY: cursor,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: CONTENT_W,
    theme: 'plain',
    head: [['#', 'Symbol', 'Name', 'Sector', 'Value', 'Weight', 'P&L']],
    body: a.positions.map((p, i) => [
      String(i + 1),
      p.symbol,
      p.name,
      p.sector || 'Unclassified',
      money(p.currentValue),
      pct(p.weight),
      pct(p.plPercent / 100),
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
      0: { cellWidth: CONTENT_W * 0.05, halign: 'center', textColor: GREY },
      1: { cellWidth: CONTENT_W * 0.12, fontStyle: 'bold' },
      2: { cellWidth: CONTENT_W * 0.29 },
      3: { cellWidth: CONTENT_W * 0.18, textColor: GREY },
      4: { cellWidth: CONTENT_W * 0.16, halign: 'right' },
      5: { cellWidth: CONTENT_W * 0.1, halign: 'right', fontStyle: 'bold' },
      6: { cellWidth: CONTENT_W * 0.1, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      const p = a.positions[data.row.index];
      if (!p) return;
      if (data.column.index === 5 && p.weight > CONCENTRATION_LIMITS.singlePosition) {
        data.cell.styles.fillColor = SEVERITY_FILL.breach;
        data.cell.styles.textColor = DANGER;
      }
      if (data.column.index === 6) {
        data.cell.styles.textColor = p.pl >= 0 ? SUCCESS : DANGER;
      }
    },
  });

  return (doc as any).lastAutoTable.finalY as number;
}

/** Builds the Risk & Exposure Report as a PDF document. */
export function buildRiskReportPdf(input: RiskReportInput): jsPDF {
  const a = analyseRisk(input);
  const doc = newDoc();
  doc.setProperties({
    title: `Risk & Exposure Report — ${input.subject}`,
    author: 'Giriraj Global Consultants',
    subject: 'Risk & Exposure Report',
  });

  const money = moneyFormatter(input.currency);

  let y = drawBanner(doc, 'Risk & Exposure Report');

  const subject =
    input.subjectKind === 'family' ? `${input.subject} (household)` : input.subject;
  const scope =
    input.subjectKind === 'family'
      ? `Merged exposure across ${input.memberCount ?? 0} member account${
          (input.memberCount ?? 0) === 1 ? '' : 's'
        } · ${a.positionCount} distinct position${a.positionCount === 1 ? '' : 's'}`
      : `${a.positionCount} position${a.positionCount === 1 ? '' : 's'} across ${
          a.sectorCount
        } sector${a.sectorCount === 1 ? '' : 's'}`;

  y = drawIdentity(doc, subject, input.asOf, `${scope} · concentration and exposure as at the date above`, y);
  y = drawScoreBand(doc, y, a, money);
  y = drawLimits(doc, y, a);
  y = drawSectors(doc, y, a, money);
  y = drawPositions(doc, y, a, money);

  drawFooter(doc, y, input.currency, riskNotes(a), { legend: false });
  stampPageNumbers(doc);
  return doc;
}

/**
 * The caveats that change what the report MEANS, rather than general
 * disclaimers. Only the ones that actually apply to this portfolio are printed
 * — a standing list of every possible caveat trains a reader to skip them.
 */
function riskNotes(a: RiskAnalysis): string[] {
  const notes: string[] = [
    'Weights are measured against total portfolio value including cash. Limits are the firm’s internal guidance, not a regulatory requirement.',
    'This report measures composition — concentration, sector spread and cash. It does not measure volatility, beta or drawdown, which require a price history this statement does not carry.',
  ];

  const unclassified = a.sectors.find((s) => /unclassified|uncategor/i.test(s.label));
  if (unclassified && unclassified.weight > 0) {
    notes.push(
      `${pct(unclassified.weight)} of the portfolio is unclassified by sector, so the sector concentration above is a lower bound — classifying those positions can only raise a sector's weight, never lower it.`,
    );
  }

  if (a.positionCount === 0) {
    notes.push('No open positions were found, so every exposure figure reads zero by construction rather than by diversification.');
  }

  return notes;
}

export function downloadRiskReportPdf(input: RiskReportInput): void {
  const doc = buildRiskReportPdf(input);
  doc.save(`${fileSlug(input.subject, 'risk-exposure', input.asOf)}.pdf`);
}
