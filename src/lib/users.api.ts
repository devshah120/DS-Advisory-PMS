import { apiClient } from './api';
import { AssignableManager, UserRole } from '@/types';

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

/**
 * `role` is absent on purpose: the API rejects it on PATCH /users/me, because
 * changing your own role is privilege escalation. Roles are assigned from the
 * Users screen (Super Admin only) via `adminUpdateUser`.
 */
export type UpdateProfileInput = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  organization: string;
}>;

/** A staff (or client-portal) login as listed on the Users admin screen. */
export interface StaffUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organization: string | null;
  role: UserRole;
  roleLabel: string;
  active: boolean;
  avatar: string | null;
  /** Created from a client record; shown read-only here. */
  isClientLogin: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  role: UserRole;
  organization?: string;
  active?: boolean;
}

/** All optional — the Users screen sends only what changed. */
export type AdminUpdateUserInput = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  /** A reset, not a change: no current password is required. */
  password: string;
  role: UserRole;
  organization: string;
  active: boolean;
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

  /**
   * Staff who can hold a book — the "Assigned Manager" options.
   *
   * Super Admin only (the API enforces it), so callers must gate the request on
   * the role rather than relying on an empty list: a Portfolio Manager hitting
   * this gets a 403, not `[]`.
   */
  async getAssignableManagers() {
    const res = await apiClient
      .getClient()
      .get<AssignableManager[]>('/users/assignable');
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

  // --- Staff management. Every call below 403s unless the caller is a Super
  // Admin; the UI hides the screen entirely for everyone else.

  async listUsers() {
    const res = await apiClient.getClient().get<StaffUser[]>('/users');
    return res.data;
  },

  async createUser(input: CreateUserInput) {
    const res = await apiClient.getClient().post<StaffUser>('/users', input);
    return res.data;
  },

  async adminUpdateUser(id: string, input: AdminUpdateUserInput) {
    const res = await apiClient
      .getClient()
      .patch<StaffUser>(`/users/${id}`, input);
    return res.data;
  },

  async deleteUser(id: string) {
    const res = await apiClient
      .getClient()
      .delete<{ message: string }>(`/users/${id}`);
    return res.data;
  },
};
