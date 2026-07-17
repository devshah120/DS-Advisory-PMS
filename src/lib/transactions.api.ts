import { apiClient } from './api';
import { CreateCashFlowInput, CreateDividendInput, Transaction } from '@/types';

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

  async remove(id: string) {
    await apiClient.getClient().delete(`/transactions/${id}`);
  },
};
