import { apiClient } from './api';
import { ClientFeeRow, FeeQuarterOption } from '@/types/reports';

export const reportsApi = {
  /** The quarter dropdown's options, newest first. */
  async feeQuarters(): Promise<FeeQuarterOption[]> {
    const res = await apiClient.getClient().get<FeeQuarterOption[]>('/reports/fees/quarters');
    return res.data;
  },

  /** Fee rows for `quarter` (e.g. "Q3-CY26"); omitted means the current quarter. */
  async fees(quarter?: string): Promise<ClientFeeRow[]> {
    const res = await apiClient.getClient().get<ClientFeeRow[]>('/reports/fees', {
      params: quarter ? { quarter } : undefined,
    });
    return res.data;
  },

  /** @deprecated Use `fees()` — kept so existing callers keep compiling. */
  async currentQuarterFees(): Promise<ClientFeeRow[]> {
    return this.fees();
  },
};
