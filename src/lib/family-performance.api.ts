import { apiClient } from './api';
import type { PeriodOption, PerformancePeriod } from './portfolio-history.api';

/**
 * Household-level performance — the same engine, the same windows and the same
 * money-weighted method as a single mandate, with a family as the subject.
 *
 * The family is measured AS ONE ACCOUNT: one combined cash-flow series, one
 * XIRR solved over it, one benchmark priced on those same flows. It is not an
 * average of the members' returns — see the service doc on the backend for why
 * a weighted mean of member XIRRs would not be a household return at all.
 */

/** One member account's contribution to the household figure. */
export interface FamilyMemberPerformance {
  clientId: string;
  clientName: string;
  openingValue: number;
  closingValue: number;
  netFlows: number;
  /**
   * The account measured on its own — the same figure its individual sheet
   * shows, so the two can be cross-checked. Null when the account cannot be
   * solved standalone (typically a member that joined mid-window), which does
   * NOT remove it from the household total.
   */
  returnPct: number | null;
  returnReason?: string;
  /** Value change over the window, net of that account's own deposits. */
  gain: number;
  /** Set when the account joins after the window opens. */
  entryDate?: string;
  /** Share of the household's closing value. */
  weight: number;
}

export interface FamilyPeriodReturn {
  familyId: string;
  familyName: string;
  market: string;
  currency: string;

  period: PerformancePeriod;
  label: string;
  from: string;
  to: string;
  clampedToInception: boolean;
  nominalFrom?: string;
  daysClamped: number;
  openPeriod: boolean;
  periodDays: number;

  openingValue: number;
  closingValue: number;
  /** Net external money into the household, including any account that joined. */
  netFlows: number;

  /** THE headline: money-weighted (XIRR) return for the household. */
  returnPct: number | null;
  annualizedReturnPct: number | null;
  returnReason?: string;
  /** Reconciliation line only — counts deposits as return. */
  simpleReturnPct: number | null;

  benchmark: {
    code: string;
    name: string;
    xirr: number | null;
    interim: number | null;
    reason?: string;
  } | null;
  alpha: number | null;

  memberCount: number;
  members: FamilyMemberPerformance[];
  lateEntrants: Array<{ clientId: string; clientName: string; entryDate: string }>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export const familyPerformanceApi = {
  /**
   * The household's selectable windows, generated from the FAMILY'S market
   * calendar — so an Indian household is offered fiscal quarters (Q2 FY27)
   * rather than calendar ones, exactly as its members are.
   */
  async periods(familyId: string): Promise<PeriodOption[]> {
    const res = await apiClient
      .getClient()
      .get<PeriodOption[]>(`/families/${familyId}/performance/periods`);
    return res.data;
  },

  async periodReturn(familyId: string, period: PerformancePeriod): Promise<FamilyPeriodReturn> {
    const res = await apiClient
      .getClient()
      .get<FamilyPeriodReturn>(`/families/${familyId}/performance/return`, {
        params: { period },
      });
    return res.data;
  },

  async customReturn(familyId: string, from: Date, to: Date): Promise<FamilyPeriodReturn> {
    const res = await apiClient
      .getClient()
      .get<FamilyPeriodReturn>(`/families/${familyId}/performance/return`, {
        params: { from: iso(from), to: iso(to) },
      });
    return res.data;
  },
};
