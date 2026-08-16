import { apiClient } from './api';
import type {
  AppSettings,
  Subscriber,
  SubscriptionStatus,
  UpdateSettingsInput,
} from '@/types/subscription';

/**
 * Every route here is SUPER_ADMIN-only server-side. The UI hides the screen
 * from other roles, but that is tidiness — the API is the boundary.
 */
export const subscriptionApi = {
  async getSettings(): Promise<AppSettings> {
    const res = await apiClient.getClient().get<AppSettings>('/subscription/settings');
    return res.data;
  },

  async updateSettings(input: UpdateSettingsInput): Promise<AppSettings> {
    const res = await apiClient
      .getClient()
      .patch<AppSettings>('/subscription/settings', input);
    return res.data;
  },

  async listSubscribers(): Promise<Subscriber[]> {
    const res = await apiClient.getClient().get<Subscriber[]>('/subscription/subscribers');
    return res.data;
  },

  async updateSubscriber(
    id: string,
    input: { status?: SubscriptionStatus; extendDays?: number }
  ): Promise<void> {
    await apiClient.getClient().patch(`/subscription/subscribers/${id}`, input);
  },
};
