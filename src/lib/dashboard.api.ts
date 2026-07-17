import { apiClient } from './api';
import { DashboardOverview, MarketQuote } from '@/types';

export const dashboardApi = {
  async overview(): Promise<DashboardOverview> {
    const res = await apiClient.getClient().get<DashboardOverview>('/dashboard/overview');
    return res.data;
  },

  async marketOverview(): Promise<MarketQuote[]> {
    const res = await apiClient.getClient().get<MarketQuote[]>('/dashboard/market-overview');
    return res.data;
  },
};
