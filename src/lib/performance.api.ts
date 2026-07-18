import { apiClient } from './api';
import { AccountingMethod, AllocationSlice } from '@/types';

/**
 * The Performance sheet's contract with the engine.
 *
 * Every field that CAN be unavailable is typed `| null`, and that is deliberate
 * rather than defensive. A client with holdings but no recorded deposits has a
 * sector allocation and a best performer, and no XIRR — and the sheet has to be
 * able to say "no XIRR, here is why" rather than rendering 0.00%, which reads as
 * "we measured this and it's zero".
 */

export interface BenchmarkResult {
  code: string;
  name: string;
  /** Annualized. Null when the index has no price coverage over the flow dates. */
  xirr: number | null;
  /** The same rate over the actual holding period — comparable to interimReturn. */
  interim: number | null;
  /** Units of the index the flows notionally bought. Ties back to the workbook. */
  units: number | null;
  value: number | null;
  reason?: string;
}

export interface PerformerRow {
  ticker: string;
  company: string;
  unrealizedPnl: number;
  returnPct: number | null;
  marketValue: number;
}

export interface TopHolding extends PerformerRow {
  weight: number;
}

/**
 * Allocation always travels with its denominator. A weight without the base it
 * was divided by is not a number, it is a rumour — a position that is 5.0% of
 * total assets is 6.4% of securities, and concentration limits fire in different
 * places depending on which was meant.
 *
 * `unclassifiedWeight` is the share of the book with no look-through mapping. It
 * is reported rather than bucketed into "Unknown": a user who can see that 12%
 * is unclassified can act on it; one shown a clean pie chart that quietly buries
 * it cannot.
 */
export interface Allocation {
  slices: AllocationSlice[];
  denominator: 'TOTAL_ASSETS' | 'SECURITIES_ONLY';
  unclassifiedWeight: number;
}

/** KPIs that need no XIRR — properties of the book, not of the solver. */
interface CrossSectional {
  portfolioValue: number;
  holdingsValue: number;
  cashBalance: number;
  cashWeight: number;

  netDeposits: number;
  netWithdrawals: number;
  netContribution: number;

  realizedGain: number;
  unrealizedGain: number;
  dividendIncome: number;
  fees: number;

  portfolioTurnover: number | null;

  bestPerformer: PerformerRow | null;
  worstPerformer: PerformerRow | null;
  topHoldings: TopHolding[];
  sectorAllocation: Allocation;
}

export interface PerformanceOk extends CrossSectional {
  status: 'ok';
  accountingMethod: AccountingMethod;

  investedCapital: number;
  realizedProceeds: number;
  unrealizedValue: number;
  totalContributed: number;
  totalWithdrawn: number;

  totalGain: number;
  absoluteReturn: number | null;
  annualizedReturn: number | null;

  xirr: number | null;
  interimReturn: number | null;
  xirrReason?: string;

  benchmark: BenchmarkResult | null;
  /** Portfolio XIRR − Benchmark XIRR, annualized. The brief's definition. */
  alpha: number | null;
  /** The same spread over the holding period. The workbook's definition. */
  alphaInterim: number | null;

  cashDrag: number | null;

  periodDays: number;
  inceptionDate: string;
  flows: Array<{ date: string; amount: number }>;
}

/**
 * The series could not be solved — almost always because the client is on the
 * cash-flow method and nobody has recorded a deposit. The cross-sectional KPIs
 * are still returned, because an empty page helps nobody.
 */
export interface PerformanceInsufficient extends CrossSectional {
  status: 'insufficient';
  accountingMethod: AccountingMethod;
  reason: string;
}

export interface PerformanceMeta {
  asOf: string;
  method: string;
  flowBasis: string;
  benchmarkBasis: string;
  includeDividends?: boolean;
  includeFees?: boolean;
  denominator: 'TOTAL_ASSETS';
  /**
   * Where the cash figure came from. `stored` means the ledger could not explain
   * the book — positions are held that nothing in it records buying — so cash was
   * taken from the stored balance instead of derived. Everything downstream of
   * cash is only as good as that fallback, and the warning says so.
   */
  cashSource: 'ledger' | 'stored';
  /** Data-integrity notes. Always render these — they are why a number may be off. */
  warnings: string[];
}

export interface PerformanceResponse {
  data: PerformanceOk | PerformanceInsufficient;
  meta: PerformanceMeta;
}

export const performanceApi = {
  async forClient(clientId: string, benchmark?: string) {
    const res = await apiClient
      .getClient()
      .get<PerformanceResponse>(`/analytics/client/${clientId}/performance`, {
        params: benchmark ? { benchmark } : undefined,
      });
    return res.data;
  },
};
