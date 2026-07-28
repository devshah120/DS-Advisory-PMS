import { apiClient } from './api';

export interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
}

/** Returned when enrolment starts — everything needed to add the account to an app. */
export interface TwoFactorSetup {
  /** Base32 secret, for manual entry when a QR code can't be scanned. */
  secret: string;
  otpauthUrl: string;
  /** PNG data URI, renderable directly in an <img src>. */
  qrCodeDataUrl: string;
}

export interface ActiveSession {
  id: string;
  browser: string;
  os: string;
  ip: string | null;
  lastSeenAt: string;
  createdAt: string;
  /** True for the device making the request; it can't revoke itself. */
  current: boolean;
}

/**
 * Identifies the calling device to the sessions endpoints. Read at call time
 * rather than module load, so it reflects the current token after a refresh.
 */
const deviceHeaders = () => {
  const token = apiClient.getRefreshToken();
  return token ? { 'x-refresh-token': token } : undefined;
};

export const securityApi = {
  async getTwoFactorStatus() {
    const res = await apiClient.getClient().get<TwoFactorStatus>('/users/me/2fa');
    return res.data;
  },

  /** Mints a secret + QR code. Nothing is enabled until `confirmTwoFactor`. */
  async startTwoFactorSetup() {
    const res = await apiClient
      .getClient()
      .post<TwoFactorSetup>('/users/me/2fa/setup');
    return res.data;
  },

  /** Verifies the first code and switches the factor on. Recovery codes are shown once. */
  async confirmTwoFactor(code: string) {
    const res = await apiClient
      .getClient()
      .post<{ enabled: boolean; recoveryCodes: string[] }>(
        '/users/me/2fa/confirm',
        { code }
      );
    return res.data;
  },

  async disableTwoFactor(password: string) {
    const res = await apiClient
      .getClient()
      .post<{ enabled: boolean }>('/users/me/2fa/disable', { password });
    return res.data;
  },

  async regenerateRecoveryCodes(password: string) {
    const res = await apiClient
      .getClient()
      .post<{ recoveryCodes: string[] }>('/users/me/2fa/recovery-codes', {
        password,
      });
    return res.data;
  },

  async getSessions() {
    const res = await apiClient
      .getClient()
      .get<ActiveSession[]>('/users/me/sessions', { headers: deviceHeaders() });
    return res.data;
  },

  async revokeSession(id: string) {
    const res = await apiClient
      .getClient()
      .delete<{ success: boolean }>(`/users/me/sessions/${id}`, {
        headers: deviceHeaders(),
      });
    return res.data;
  },

  /** Signs out every device except this one. */
  async revokeOtherSessions() {
    const res = await apiClient
      .getClient()
      .delete<{ success: boolean; revoked: number }>('/users/me/sessions', {
        headers: deviceHeaders(),
      });
    return res.data;
  },
};
