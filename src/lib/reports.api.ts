import { apiClient } from './api';
import { ClientFeeRow, FeeQuarterOption } from '@/types/reports';
import type { Market } from './market-scope';

export const reportsApi = {
  /** The quarter dropdown's options, newest first. */
  async feeQuarters(): Promise<FeeQuarterOption[]> {
    const res = await apiClient.getClient().get<FeeQuarterOption[]>('/reports/fees/quarters');
    return res.data;
  },

  /**
   * Fee rows for `quarter` (e.g. "Q3-CY26"); omitted means the current quarter.
   * `market` scopes to one book — the table sums a total, and mixing books
   * would total two currencies together.
   */
  async fees(quarter?: string, market?: Market): Promise<ClientFeeRow[]> {
    const res = await apiClient.getClient().get<ClientFeeRow[]>('/reports/fees', {
      params: { ...(quarter ? { quarter } : {}), ...(market ? { market } : {}) },
    });
    return res.data;
  },

  /** @deprecated Use `fees()` — kept so existing callers keep compiling. */
  async currentQuarterFees(): Promise<ClientFeeRow[]> {
    return this.fees();
  },
};
