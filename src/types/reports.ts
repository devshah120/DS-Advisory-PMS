export interface ClientFeeRow {
  clientId: string;
  clientName: string;
  feeRatePercent: number;
  portfolioValue: number;
  /** Canonical quarter code, e.g. "Q3-CY26". */
  quarter: string;
  quarterLabel: string;
  quarterStart: string;
  quarterEnd: string;
  daysBilled: number;
  daysInQuarter: number;
  /**
   * True for a quarter still in progress — portfolioValue is today's live
   * value. False means the row came from a frozen fee record: the amount
   * actually billed for that closed quarter.
   */
  isEstimate: boolean;
  feeAmount: number;
  /** 'snapshot' | 'reconstruction' | 'live' | 'unavailable'. */
  valuationSource: string;
  /** The client's own reporting currency — the unit this fee was billed in. */
  currency: string;
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
