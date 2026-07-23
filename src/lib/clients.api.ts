import { AxiosError } from 'axios';
import { apiClient } from './api';
import {
  AccountingMethod,
  Client,
  PaginatedResponse,
  RiskProfile,
  ClientStatus,
} from '@/types';

export interface CreateClientInput {
  name: string;
  broker: string;
  accountNumber: string;
  /** Optional contact email. Omit when blank — the API rejects "". */
  email?: string;
  benchmark: string;
  riskProfile: RiskProfile;
  /** Required: decides how this client's XIRR is computed. No safe default. */
  accountingMethod: AccountingMethod;
  /** Required: annual management fee as a percent (e.g. 2 for 2%). 0 is a valid "no fee". */
  feeRatePercent: number;
  /** Required: ISO date string. The mandate's actual start date, not when the record was created. */
  inceptionDate: string;
  currency?: string;
  status?: ClientStatus;
  cashBalance?: number;
  portfolioValue?: number;
  notes?: string;
}

export type UpdateClientInput = Partial<CreateClientInput>;

/** Field-level errors keyed by form field, plus a form-level message. */
export interface ApiFieldErrors {
  message: string;
  fields: Record<string, string>;
}

/**
 * Turn an API failure into a form-level message plus inline field errors.
 *
 * The backend's ValidationPipe emits a structured `errors` map keyed by
 * property name; prefer that. Fall back to the default `message` string[]
 * for any endpoint that hasn't been migrated.
 */
export function parseApiError(err: unknown): ApiFieldErrors {
  const fallback = { message: 'Something went wrong. Please try again.', fields: {} };
  if (!(err instanceof AxiosError)) return fallback;

  if (!err.response) {
    return { message: 'Cannot reach the server. Check your connection.', fields: {} };
  }

  const { status, data } = err.response;

  if (status === 401) {
    return { message: 'Your session expired. Please sign in again.', fields: {} };
  }

  // Preferred: structured field map from validationExceptionFactory.
  if (data?.errors && typeof data.errors === 'object') {
    return {
      message: 'Please correct the highlighted fields.',
      fields: data.errors as Record<string, string>,
    };
  }

  const raw = data?.message;

  // Conflict / not-found / any single-string error.
  if (typeof raw === 'string') return { message: raw, fields: {} };

  // Legacy: "accountNumber must be shorter than 64 characters"
  if (Array.isArray(raw)) {
    const fields: Record<string, string> = {};
    for (const line of raw as string[]) {
      const key = line.split(' ')[0];
      if (key && !fields[key]) fields[key] = line;
    }
    return {
      message: raw.length === 1 ? raw[0] : 'Please correct the highlighted fields.',
      fields,
    };
  }

  return fallback;
}

export const clientsApi = {
  async list(params?: { page?: number; limit?: number }) {
    const res = await apiClient
      .getClient()
      .get<PaginatedResponse<Client> | Client[]>('/clients', { params });
    // Tolerate both the paginated envelope and a bare array (mock mode).
    return Array.isArray(res.data) ? res.data : res.data.data;
  },

  async get(id: string) {
    const res = await apiClient.getClient().get<Client>(`/clients/${id}`);
    return res.data;
  },

  async create(input: CreateClientInput) {
    const res = await apiClient.getClient().post<Client>('/clients', input);
    return res.data;
  },

  async update(id: string, input: UpdateClientInput) {
    const res = await apiClient.getClient().patch<Client>(`/clients/${id}`, input);
    return res.data;
  },

  async remove(id: string) {
    await apiClient.getClient().delete(`/clients/${id}`);
  },
};
