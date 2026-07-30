import { apiClient } from './api';
import { AllocationSlice } from '@/types';

/**
 * The Legacy Baseline / Historical Reconstruction engine's contract with the
 * frontend — a separate, additive API from performance.api.ts.
 *
 * performance.api.ts answers "what is this client's XIRR since inception,
 * against a benchmark". This answers a different question: "what did the
 * portfolio look like on any specific date after its baseline", and "what
 * was the return over a calendar period (MTD/QTD/YTD/custom)". Neither
 * engine's numbers should be expected to reconcile exactly with the other —
 * one replays a transaction ledger onto an imported opening position, the
 * other solves a money-weighted rate on a rebased flow series.
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
  cash: number;
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

export type PerformancePeriod = 'MTD' | 'QTD' | 'YTD' | 'CUSTOM';

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
  from: string;
  to: string;
  openingValue: number;
  closingValue: number;
  /** Null when the opening value is zero — nothing to divide by. */
  returnPct: number | null;
  /** Null when the client has no benchmark configured. */
  benchmark: BenchmarkWindowResult | null;
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

  async periodReturn(
    clientId: string,
    period: 'MTD' | 'QTD' | 'YTD',
  ): Promise<PeriodReturn> {
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
