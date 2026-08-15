import { apiClient } from './api';
import { PortfolioEvent } from '@/types';
import type { Market } from './market-scope';

export interface EventRefreshResult {
  refreshed: number;
  tickers: number;
}

export const eventsApi = {
  /**
   * The selected book's calendar only — an Indian mandate's review never shows
   * a US ex-date. Covers held and watchlisted names alike.
   */
  async forHoldings(market?: Market): Promise<PortfolioEvent[]> {
    const res = await apiClient
      .getClient()
      .get<PortfolioEvent[]>('/events', { params: market ? { market } : undefined });
    return res.data;
  },

  /** Re-fetch the FMP calendars and replace the stored snapshot. */
  async refresh(): Promise<EventRefreshResult> {
    const res = await apiClient.getClient().post<EventRefreshResult>('/events/refresh');
    return res.data;
  },
};
