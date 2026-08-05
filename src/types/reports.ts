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
}

/** One entry in the quarter dropdown. */
export interface FeeQuarterOption {
  code: string;
  label: string;
  closed: boolean;
}
