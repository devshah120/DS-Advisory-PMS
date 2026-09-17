import { apiClient } from './api';
import {
  CreateCashFlowInput,
  CreateDividendInput,
  Transaction,
  UpdateTransactionInput,
} from '@/types';

export const transactionsApi = {
  async list() {
    const res = await apiClient.getClient().get<Transaction[]>('/transactions');
    return res.data;
  },

  async listForClient(clientId: string) {
    const res = await apiClient
      .getClient()
      .get<Transaction[]>(`/transactions/client/${clientId}`);
    return res.data;
  },

  /**
   * The dated buy/sell lots behind a single position.
   *
   * The ticker is encoded because Indian symbols carry a '.NS' suffix and a
   * raw dot in a path segment is at the mercy of whatever normalises the URL
   * on the way through.
   */
  async listLots(clientId: string, ticker: string) {
    const res = await apiClient
      .getClient()
      .get<Transaction[]>(
        `/transactions/client/${clientId}/lots/${encodeURIComponent(ticker)}`
      );
    return res.data;
  },

  /**
   * Record an external inflow/outflow. The backend maps direction -> type
   * (cash_deposit / cash_withdrawal) and stores the amount as a positive number,
   * so the sign convention lives in exactly one place.
   */
  async createCashFlow(input: CreateCashFlowInput) {
    const res = await apiClient
      .getClient()
      .post<Transaction>('/transactions/cash-flow', input);
    return res.data;
  },

  /**
   * Record a dividend received. It raises the client's return under both
   * accounting methods — as an explicit positive flow for transactional clients,
   * and through the cash balance (and therefore the NAV) for cash-flow clients.
   */
  async createDividend(input: CreateDividendInput) {
    const res = await apiClient
      .getClient()
      .post<Transaction>('/transactions/dividend', input);
    return res.data;
  },

  /**
   * Correct an existing row. PATCH, so only the changed fields travel — the
   * backend leaves every key the payload omits alone.
   *
   * Returns the whole corrected transaction (the backend re-reads it), which is
   * what the caller should splice into its list rather than its own optimistic
   * merge: the server normalises the ticker's casing and the date.
   */
  async update(id: string, input: UpdateTransactionInput) {
    const res = await apiClient
      .getClient()
      .patch<Transaction>(`/transactions/${id}`, input);
    return res.data;
  },

  async remove(id: string) {
    await apiClient.getClient().delete(`/transactions/${id}`);
  },

  /**
   * Delete a selection in one round trip.
   *
   * `deleted` can be lower than `ids.length` — the backend keeps only the rows
   * still present and still in the caller's book — so the caller should report
   * that number rather than assuming the whole selection went.
   */
  async removeMany(ids: string[]) {
    const res = await apiClient
      .getClient()
      .post<{ success: boolean; requested: number; deleted: number }>(
        '/transactions/bulk-delete',
        { ids }
      );
    return res.data;
  },
};
