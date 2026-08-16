import { apiClient } from './api';
import { AllocationSlice } from '@/types';

/**
 * The period-return engine's contract with the frontend, and the one the
 * Performance page is built on.
 *
 * It answers "what did this book return over THIS window, money-weighted,
 * against the index over the same window" for any period on the client's
 * reporting calendar — plus "what did the portfolio look like on the date that
 * window ends".
 *
 * Both this and performance.api.ts now solve XIRR, and deliberately so: the
 * page used to show a money-weighted since-inception figure beside a naive
 * (close−open)/open period figure, which meant a mid-period deposit inflated
 * the period number while the benchmark beside it stayed flow-adjusted. Same
 * method on both sides is what makes the alpha on this page mean anything.
 * performance.api.ts remains the since-inception sheet; this is every other
 * window.
 */

export interface HistoricalPosition {
  ticker: string;
  quantity: number;
  averageCost: number;
  closingPrice: number;
  marketValue: number;
  costBasisTotal: number;
  unrealizedGain: number;
  sector: string;
  industry: string;
  country: string;
  weight: number;
}

export interface Allocation {
  slices: AllocationSlice[];
  denominator: 'TOTAL_ASSETS' | 'SECURITIES_ONLY';
  unclassifiedWeight: number;
}

/**
 * The response for "portfolio as of date X". `source` says whether a stored
 * daily/quarter-end snapshot answered it or a live replay had to — shown as
 * a small provenance note in the UI, not hidden, even though the numbers
 * themselves are meant to be indistinguishable either way.
 */
export interface PortfolioAsOf {
  clientId: string;
  asOfDate: string;
  baselineDate: string;
  /** Floored at zero — the engine never reports a negative buying-power balance. */
  cash: number;
  /**
   * How far below zero the replayed cash went before being floored, or 0. Non-zero
   * means the ledger has a genuine gap worth surfacing rather than hiding inside
   * the weights.
   */
  cashShortfall: number;
  holdingsValue: number;
  portfolioValue: number;
  totalCost: number;
  unrealizedGain: number;
  realizedGain: number;
  positions: HistoricalPosition[];
  sectorAllocation: Allocation;
  countryAllocation: Allocation;
  assetAllocation: Allocation;
  source: 'snapshot' | 'reconstruction';
}

/**
 * Any code the backend's `resolvePeriod` accepts: 'INCEPTION', the rolling
 * windows ('QTD' | 'FYTD' | 'CYTD' | 'MTD'), 'CUSTOM', or a named period like
 * 'Q2-FY27' / 'FY27'. A string rather than a closed union because the codes are
 * generated from the market's calendar — the selectable list comes from
 * `periods()` below, not from this type.
 */
export type PerformancePeriod = string;

/** One entry in the period dropdown. */
export interface PeriodOption {
  code: string;
  label: string;
  /** The concrete window, e.g. "01 Jul 2026 → today". Rendered beside the label. */
  hint: string;
  /** The optgroup this option belongs under. */
  group: 'Current' | 'Quarters' | 'Years' | 'Custom';
}

/**
 * The index over the SAME window, same unit-purchase construction as the
 * Current tab's Alpha card (PerformanceService.benchmark() /
 * benchmarkXirr()) — not a plain point-to-point index return. `interim` is
 * the figure comparable to the client's own return for the window; `xirr`
 * is its annualized form, kept for reference the same way the Current tab
 * keeps both.
 */
export interface BenchmarkWindowResult {
  code: string;
  name: string;
  xirr: number | null;
  interim: number | null;
  reason?: string;
}

export interface PeriodReturn {
  period: PerformancePeriod;
  /** Human label for the window, e.g. "Q2 FY27". */
  label: string;
  from: string;
  to: string;
  /** True when `from` was pulled forward to the 30-June-2026 inception. */
  clampedToInception: boolean;
  /** Where the window would have opened without that clamp. */
  nominalFrom?: string;
  /** Days lost to the clamp — 0 when the window is whole. */
  daysClamped: number;
  /** True when the period has not closed yet, so `to` is today. */
  openPeriod: boolean;
  /** Calendar length of the measured window. */
  periodDays: number;

  openingValue: number;
  closingValue: number;
  /** Net external money added during the window (deposits − withdrawals). */
  netFlows: number;

  /**
   * THE headline: money-weighted (XIRR) return over the window, de-annualized
   * to the window's length. Flow-adjusted, so a mid-period deposit counts as
   * capital arriving rather than as performance.
   */
  returnPct: number | null;
  /** The same rate annualized. Null on windows under 30 days. */
  annualizedReturnPct: number | null;
  /** Why the solver found no rate, when it didn't. */
  returnReason?: string;
  /**
   * The naive (closing − opening) / opening figure. Ties to a custody
   * statement, but counts deposits as return — shown as a reconciliation line,
   * never as the headline.
   */
  simpleReturnPct: number | null;

  /** Null when the client has no benchmark configured. */
  benchmark: BenchmarkWindowResult | null;
  /** Portfolio − benchmark over this window, both money-weighted. */
  alpha: number | null;
}

export interface AutoSeedSummary {
  created: string[];
  skipped: string[];
  failed: Array<{ clientId: string; reason: string }>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export const portfolioHistoryApi = {
  /** No baseline yet -> the backend 404s; callers should treat that as "not set up" rather than an error. */
  async asOf(clientId: string, date: Date): Promise<PortfolioAsOf> {
    const res = await apiClient
      .getClient()
      .get<PortfolioAsOf>(`/clients/${clientId}/portfolio-history/as-of/${iso(date)}`);
    return res.data;
  },

  /**
   * The selectable periods, generated by the backend from the CLIENT'S OWN
   * market calendar so the dropdown can never offer a window `resolvePeriod`
   * would reject — and so an Indian mandate is offered fiscal quarters
   * (Q2 FY27) rather than calendar ones.
   *
   * No `market` param is sent: the backend reads it off the client record,
   * which cannot go stale the way a param passed from a UI toggle can.
   */
  async periods(clientId: string): Promise<PeriodOption[]> {
    const res = await apiClient
      .getClient()
      .get<PeriodOption[]>(`/clients/${clientId}/portfolio-history/periods`);
    return res.data;
  },

  /** `period` is any code from `periods()` — 'QTD', 'FYTD', 'Q2-FY27', … */
  async periodReturn(clientId: string, period: PerformancePeriod): Promise<PeriodReturn> {
    const res = await apiClient
      .getClient()
      .get<PeriodReturn>(`/clients/${clientId}/portfolio-history/return`, {
        params: { period },
      });
    return res.data;
  },

  async customReturn(clientId: string, from: Date, to: Date): Promise<PeriodReturn> {
    const res = await apiClient
      .getClient()
      .get<PeriodReturn>(`/clients/${clientId}/portfolio-history/return`, {
        params: { from: iso(from), to: iso(to) },
      });
    return res.data;
  },

  /**
   * Seeds a Legacy Portfolio Baseline for every client that doesn't have one
   * yet, from their current Holdings + the 30-June-2026 price close — no
   * hand-typed holdings required. Safe to call repeatedly: already-seeded
   * clients come back in `skipped`, never re-created.
   */
  async autoSeedBaselines(): Promise<AutoSeedSummary> {
    const res = await apiClient.getClient().post<AutoSeedSummary>('/clients/baselines/auto-seed');
    return res.data;
  },
};
