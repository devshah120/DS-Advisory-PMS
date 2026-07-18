import { apiClient } from './api';
import { PortfolioEvent } from '@/types';

export const eventsApi = {
  async forHoldings(): Promise<PortfolioEvent[]> {
    const res = await apiClient.getClient().get<PortfolioEvent[]>('/events');
    return res.data;
  },
};
