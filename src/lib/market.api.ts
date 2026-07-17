import { apiClient } from './api';

export interface SymbolLookup {
  ticker: string;
  company: string;
  sector: string;
  industry: string;
  country: string;
  theme: string;
  exchange: string;
  currentPrice?: number;
  currency?: string;
  source: 'yahoo' | 'fallback';
}

export class SymbolNotFoundError extends Error {
  constructor(ticker: string) {
    super(`No symbol found for "${ticker}"`);
    this.name = 'SymbolNotFoundError';
  }
}

export const marketApi = {
  async lookup(ticker: string, signal?: AbortSignal): Promise<SymbolLookup> {
    try {
      const res = await apiClient
        .getClient()
        .get<SymbolLookup>(`/market/lookup/${encodeURIComponent(ticker)}`, { signal });
      return res.data;
    } catch (err: any) {
      if (err?.response?.status === 404) throw new SymbolNotFoundError(ticker);
      throw err;
    }
  },
};
