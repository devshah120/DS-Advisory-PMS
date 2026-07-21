import { apiClient } from './api';
import { FundamentalView } from '@/types';

export const fundamentalsApi = {
  async list(strategy?: string, symbols?: string[]): Promise<FundamentalView[]> {
    const res = await apiClient.getClient().get<FundamentalView[]>('/fundamentals', {
      params: {
        ...(strategy ? { strategy } : {}),
        ...(symbols?.length ? { symbols: symbols.join(',') } : {}),
      },
    });
    return res.data;
  },

  async getOne(symbol: string, strategy?: string): Promise<FundamentalView> {
    const res = await apiClient.getClient().get<FundamentalView>(`/fundamentals/${symbol}`, {
      params: strategy ? { strategy } : undefined,
    });
    return res.data;
  },

  async strategies(): Promise<string[]> {
    const res = await apiClient.getClient().get<string[]>('/fundamentals/strategies');
    return res.data;
  },

  /** `skipped` are symbols with no company behind them (ETFs, funds, dead tickers) — not errors. */
  async refresh(): Promise<{ refreshed: number; failed: string[]; skipped: string[] }> {
    const res = await apiClient
      .getClient()
      .post<{ refreshed: number; failed: string[]; skipped: string[] }>('/fundamentals/refresh');
    return res.data;
  },
};
