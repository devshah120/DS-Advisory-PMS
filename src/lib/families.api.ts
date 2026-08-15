import { apiClient } from './api';
import type { Family, FamilyAggregate } from '@/types';
import type { Market } from './market-scope';

export interface CreateFamilyInput {
  name: string;
  /**
   * Which book the household belongs to. The form sends the currently-selected
   * market; the server defaults to US when omitted. Fixed at creation — a
   * family cannot later be moved between books.
   */
  market?: Market;
  /** Member client ids. Omit to create an empty family and add accounts later. */
  clientIds?: string[];
  notes?: string;
}

export type UpdateFamilyInput = Partial<CreateFamilyInput>;

export const familiesApi = {
  /** `market` narrows to one book; omit it to list every family. */
  async list(market?: Market): Promise<Family[]> {
    const res = await apiClient
      .getClient()
      .get<Family[]>('/families', { params: market ? { market } : undefined });
    return res.data;
  },

  async get(id: string): Promise<Family> {
    const res = await apiClient.getClient().get<Family>(`/families/${id}`);
    return res.data;
  },

  /**
   * The integrated household portfolio — every member's positions merged by
   * symbol with duplicates collapsed, quantities summed, cost blended by
   * weight, plus the combined sector allocation.
   */
  async aggregate(id: string): Promise<FamilyAggregate> {
    const res = await apiClient.getClient().get<FamilyAggregate>(`/families/${id}/aggregate`);
    return res.data;
  },

  async create(input: CreateFamilyInput): Promise<Family> {
    const res = await apiClient.getClient().post<Family>('/families', input);
    return res.data;
  },

  async update(id: string, input: UpdateFamilyInput): Promise<Family> {
    const res = await apiClient.getClient().patch<Family>(`/families/${id}`, input);
    return res.data;
  },

  async remove(id: string): Promise<void> {
    await apiClient.getClient().delete(`/families/${id}`);
  },
};
