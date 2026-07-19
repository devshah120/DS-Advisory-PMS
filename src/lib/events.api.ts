import { apiClient } from './api';
import { PortfolioEvent } from '@/types';

export interface EventRefreshResult {
  refreshed: number;
  tickers: number;
}

export const eventsApi = {
  async forHoldings(): Promise<PortfolioEvent[]> {
    const res = await apiClient.getClient().get<PortfolioEvent[]>('/events');
    return res.data;
  },

  /** Re-fetch the FMP calendars and replace the stored snapshot. */
  async refresh(): Promise<EventRefreshResult> {
    const res = await apiClient.getClient().post<EventRefreshResult>('/events/refresh');
    return res.data;
  },
};
