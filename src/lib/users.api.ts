import { apiClient } from './api';
import { UserRole } from '@/types';

/** Shape returned by GET/PATCH /users/me. Never carries a password. */
export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Null when the user has never set one. */
  organization: string | null;
  role: UserRole;
  avatar: string | null;
  createdAt: string;
  updatedAt: string;
}

export type UpdateProfileInput = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  organization: string;
  role: UserRole;
}>;

export interface UserPreferences {
  theme: string;
  baseCurrency: string;
  dateFormat: string;
  numberFormat: string;
  density: string;
}

export interface UserNotifications {
  tradeAlerts: boolean;
  priceTargets: boolean;
  weeklyDigest: boolean;
  corporateActions: boolean;
  productUpdates: boolean;
}

export const usersApi = {
  async getProfile() {
    const res = await apiClient.getClient().get<UserProfile>('/users/me');
    return res.data;
  },

  async updateProfile(input: UpdateProfileInput) {
    const res = await apiClient.getClient().patch<UserProfile>('/users/me', input);
    return res.data;
  },

  async getPreferences() {
    const res = await apiClient
      .getClient()
      .get<UserPreferences>('/users/me/preferences');
    return res.data;
  },

  async updatePreferences(input: Partial<UserPreferences>) {
    const res = await apiClient
      .getClient()
      .patch<UserPreferences>('/users/me/preferences', input);
    return res.data;
  },

  async getNotifications() {
    const res = await apiClient
      .getClient()
      .get<UserNotifications>('/users/me/notifications');
    return res.data;
  },

  async updateNotifications(input: Partial<UserNotifications>) {
    const res = await apiClient
      .getClient()
      .patch<UserNotifications>('/users/me/notifications', input);
    return res.data;
  },

  async changePassword(input: { currentPassword: string; newPassword: string }) {
    const res = await apiClient
      .getClient()
      .post<{ message: string }>('/users/me/password', input);
    return res.data;
  },
};
