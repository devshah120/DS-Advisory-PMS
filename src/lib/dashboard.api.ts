import { apiClient } from './api';
import { DashboardOverview, MarketQuote } from '@/types';
import type { Market } from './market-scope';

export const dashboardApi = {
  /**
   * `market` scopes every figure in the response to one book of business. It is
   * optional on the wire (the server defaults to the US book) so a caller that
   * predates the Indian book keeps working unchanged.
   */
  async overview(market?: Market): Promise<DashboardOverview> {
    const res = await apiClient.getClient().get<DashboardOverview>('/dashboard/overview', {
      params: market ? { market } : undefined,
    });
    return res.data;
  },

  async marketOverview(market?: Market): Promise<MarketQuote[]> {
    const res = await apiClient.getClient().get<MarketQuote[]>('/dashboard/market-overview', {
      params: market ? { market } : undefined,
    });
    return res.data;
  },
};
