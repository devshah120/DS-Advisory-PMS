/**
 * One billed component of a fee: the opening book, or one day's net capital
 * deployment. Together they explain the total.
 */
export interface FeeSegment {
  /** ISO date this component started billing from. */
  from: string;
  kind: 'opening' | 'flow';
  /** Capital billed. Negative for a net sell day, which reduces the fee. */
  amount: number;
  days: number;
  fee: number;
}

export interface ClientFeeRow {
  clientId: string;
  clientName: string;
  feeRatePercent: number;
  /**
   * The capital the fee was charged against: the opening book plus capital
   * deployed during the quarter. Not quarter-end NAV — market movement on
   * already-billed capital does not change the base.
   */
  portfolioValue: number;
  /**
   * The book at quarter start. Null on rows frozen before proration shipped.
   *
   * Optional because an API deployed before segmented proration omits the
   * field entirely — see `segments`.
   */
  openingValue?: number | null;
  /**
   * Why the fee is the number it is. Empty on rows frozen before segmented
   * proration shipped — those carry only a total.
   *
   * OPTIONAL, and it must stay optional. An API that predates this feature
   * sends no such field, and a non-optional type told the compiler it was
   * always present — which is exactly how `segments.some(...)` shipped and
   * crashed the whole fee table against an older server. Read it through
   * `feeSegments()` rather than touching it directly.
   */
  segments?: FeeSegment[];
  /** Canonical quarter code, e.g. "Q3-CY26". */
  quarter: string;
  quarterLabel: string;
  quarterStart: string;
  quarterEnd: string;
  /**
   * Days the OPENING book was billed for. Capital deployed later carries its
   * own day-count in `segments` — this number does not describe it, so it
   * must never be shown as though it were the whole story.
   */
  daysBilled: number;
  daysInQuarter: number;
  /**
   * True for a quarter still in progress — the figures run to today and will
   * change. False means the row came from a frozen fee record: the amount
   * actually billed for that closed quarter.
   */
  isEstimate: boolean;
  feeAmount: number;
  /** 'snapshot' | 'reconstruction' | 'live' | 'unavailable'. */
  valuationSource: string;
  /** The client's own reporting currency — the unit this fee was billed in. */
  currency: string;
}

/**
 * A fee row's segments, safe to iterate.
 *
 * The ONLY way this field should be read. A fee row can arrive without it —
 * from an API deployed before segmented proration, or as a frozen row billed
 * on the old single-NAV basis — and an absent breakdown means "billed as one
 * amount", which an empty list expresses correctly at every call site.
 */
export function feeSegments(row: {
  segments?: FeeSegment[] | null;
}): FeeSegment[] {
  return row.segments ?? [];
}

/** How many separately prorated tranches a fee row carries. */
export function proratedTrancheCount(row: { segments?: FeeSegment[] | null }): number {
  return feeSegments(row).filter((s) => s.kind === 'flow').length;
}

/** One member account that could not be billed this quarter, and why. */
export interface UnbilledMember {
  clientId: string;
  clientName: string;
  reason: string;
}

/**
 * A household's fee invoice for one quarter.
 *
 * `lines` are the members' OWN fee rows, unchanged — the household total is
 * their sum, never a recomputation from a combined portfolio value. That is
 * what guarantees this invoice and each member's individual statement agree.
 */
export interface FamilyFeeInvoice {
  familyId: string;
  familyName: string;
  market: string;
  /** The single unit every figure is in — a family lives in one book. */
  currency: string;

  quarter: string;
  quarterLabel: string;
  quarterStart: string;
  quarterEnd: string;
  /** True while the quarter is open: the invoice is an estimate, not a bill. */
  isEstimate: boolean;

  lines: ClientFeeRow[];
  /** Members not billable this quarter, named rather than silently dropped. */
  unbilled: UnbilledMember[];

  totals: {
    memberCount: number;
    billedCount: number;
    portfolioValue: number;
    feeAmount: number;
    /**
     * Back-solved from what was billed, against the value-weighted proration.
     * Null when nothing was billable. Members can sit on different rates, so no
     * single member's rate describes the household.
     */
    effectiveAnnualRatePercent: number | null;
  };
}

/** One entry in the household selector on the fee page. */
export interface InvoiceableFamily {
  id: string;
  name: string;
  memberCount: number;
}

/** One entry in the quarter dropdown. */
export interface FeeQuarterOption {
  code: string;
  label: string;
  closed: boolean;
}

/** Short-term or long-term, decided per lot by its own holding period. */
export type GainTerm = 'SHORT' | 'LONG';

/**
 * One depletion of one tax lot by one sale — a single line of the capital-gains
 * statement, and the unit that ties to a broker contract note.
 *
 * A sale spanning several lots produces several of these, which is exactly what
 * a broker statement itemises and what an average-cost figure cannot express.
 */
export interface RealizedGainRow {
  ticker: string;
  quantity: number;
  /** ISO date. The lot's own acquisition date — this decides the term. */
  acquiredOn: string;
  soldOn: string;
  holdingDays: number;
  term: GainTerm;
  costPerShare: number;
  proceedsPerShare: number;
  costBasis: number;
  proceeds: number;
  gain: number;
  /** Zero-cost shares from a bonus issue. */
  fromBonus: boolean;
  /** True when India s.112A grandfathering raised the basis. */
  grandfathered: boolean;
  /** Cost before grandfathering — kept so the working is auditable. */
  originalCostPerShare: number;
}

/**
 * Gains and losses are carried separately, not just netted.
 *
 * Set-off rules treat them differently — an Indian short-term loss may offset
 * either term, a long-term loss only long-term gains — so a statement that only
 * showed the net could not support the working a CA actually files.
 */
export interface GainBucket {
  gains: number;
  losses: number;
  net: number;
  proceeds: number;
  costBasis: number;
  transactions: number;
}

export interface CapitalGainsSummary {
  market: string;
  fiscalYear: number;
  /** Display label, e.g. "FY27" (India) or "CY26" (US). */
  label: string;
  periodStart: string;
  periodEnd: string;
  shortTerm: GainBucket;
  longTerm: GainBucket;
  total: GainBucket;
  rows: RealizedGainRow[];
}

/** A sale the ledger could not match to a purchase — no defensible cost basis. */
export interface UnmatchedSale {
  ticker: string;
  quantity: number;
  date: string;
  proceeds: number;
}

export interface OpenLot {
  ticker: string;
  quantity: number;
  unitCost: number;
  acquiredOn: string;
  fromBonus: boolean;
}

export interface CapitalGainsReport {
  clientId: string;
  clientName: string;
  market: string;
  currency: string;
  /** Years with realized activity, newest first. Drives the year dropdown. */
  availableYears: number[];
  fiscalYear: number | null;
  summary: CapitalGainsSummary | null;
  allYears: CapitalGainsSummary[];
  unmatchedSales: UnmatchedSale[];
  /**
   * True when reported lots rest on bulk-import acquisition dates rather than
   * real ones, making the short/long-term split unreliable. The UI MUST warn on
   * this: the error runs against the client, overstating their tax.
   */
  hasSyntheticAcquisitionDates: boolean;
  openLots: OpenLot[];
}
