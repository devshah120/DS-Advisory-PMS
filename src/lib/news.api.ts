import { apiClient } from './api';
import { NewsFeedItem } from '@/types';
import type { Market } from './market-scope';

export interface NewsRefreshResult {
  /** Stories stored that were not already known. */
  created: number;
  /** Rows dropped for falling past the retention window. */
  pruned: number;
  tickers: number;
}

export const newsApi = {
  /**
   * The selected book's feed — news and filings for every held or watchlisted
   * name, newest first. Served from the stored snapshot, so it returns fast and
   * keeps working while an upstream is down.
   */
  async feed(market?: Market, opts: { limit?: number; ticker?: string } = {}): Promise<NewsFeedItem[]> {
    const res = await apiClient.getClient().get<NewsFeedItem[]>('/news', {
      params: {
        ...(market ? { market } : {}),
        ...(opts.limit ? { limit: opts.limit } : {}),
        ...(opts.ticker ? { ticker: opts.ticker } : {}),
      },
    });
    return res.data;
  },

  /** Re-fetch every source and store new stories. Takes a few seconds. */
  async refresh(): Promise<NewsRefreshResult> {
    const res = await apiClient.getClient().post<NewsRefreshResult>('/news/refresh');
    return res.data;
  },
};
