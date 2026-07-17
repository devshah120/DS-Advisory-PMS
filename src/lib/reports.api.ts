import { apiClient } from './api';
import { ClientFeeRow } from '@/types/reports';

export const reportsApi = {
  async currentQuarterFees(): Promise<ClientFeeRow[]> {
    const res = await apiClient.getClient().get<ClientFeeRow[]>('/reports/fees');
    return res.data;
  },
};
