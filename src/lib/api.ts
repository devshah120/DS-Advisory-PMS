import axios, { AxiosError, AxiosInstance } from 'axios';
import { AuthToken } from '@/types';
import { mockClients, mockHoldings, mockTransactions } from './mockData';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

// Run the whole app without the backend/database. Defaults to ON; set
// NEXT_PUBLIC_USE_MOCK="false" to talk to the real API instead.
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK !== 'false';

const genId = () => 'mock-' + Math.random().toString(36).slice(2, 10);

// Resolves an axios-style request from in-memory mock data. Returns a value
// for handled routes, or `undefined` to let the real request proceed.
function handleMock(config: any): any | undefined {
  const method = (config.method || 'get').toLowerCase();
  const url: string = (config.url || '').split('?')[0];
  const body =
    typeof config.data === 'string'
      ? safeParse(config.data)
      : config.data || {};

  const ok = (data: any, status = 200) => ({
    data,
    status,
    statusText: status === 201 ? 'Created' : 'OK',
    headers: {},
    config,
  });

  // Reject with a real AxiosError so response interceptors and `parseApiError`
  // see the same shape they'd get from the network.
  const err = (
    status: number,
    message: string | string[],
    errors?: Record<string, string>
  ) => {
    const response = {
      data: { statusCode: status, message, ...(errors ? { errors } : {}) },
      status,
      statusText: status === 409 ? 'Conflict' : status === 404 ? 'Not Found' : 'Bad Request',
      headers: {},
      config,
    };
    return {
      __mockError: new AxiosError(
        Array.isArray(message) ? message[0] : message,
        String(status),
        config,
        null,
        response as any
      ),
    };
  };

  // --- Auth ---
  // Authentication always hits the real backend so credentials are validated
  // against the database and a real JWT is issued — never a fake token, even
  // when the rest of the app runs on mock data.

  // --- Dashboard ---
  // Overview and market-overview both need live market data (holdings P&L,
  // Yahoo quotes), so — like /watchlist and /market/* — these fall through
  // to the real backend instead of a static fixture.

  // --- Clients ---
  if (url.endsWith('/clients') && method === 'get') {
    return ok(mockClients);
  }
  if (url.endsWith('/clients') && method === 'post') {
    // Mirror the backend's validation so mock mode exercises the same paths.
    const required: Record<string, string> = {
      name: 'Client name is required',
      broker: 'Broker is required',
      accountNumber: 'Account number is required',
      benchmark: 'Benchmark is required',
    };
    const fieldErrors: Record<string, string> = {};
    for (const [field, msg] of Object.entries(required)) {
      if (!String(body[field] ?? '').trim()) fieldErrors[field] = msg;
    }
    if (Object.keys(fieldErrors).length) {
      return err(400, Object.values(fieldErrors), fieldErrors);
    }

    const duplicate = mockClients.some(
      (c) => c.broker === body.broker && c.accountNumber === body.accountNumber
    );
    if (duplicate) {
      return err(
        409,
        `Account ${body.accountNumber} already exists for broker ${body.broker}`
      );
    }

    const client = {
      id: genId(),
      currency: 'USD',
      status: 'active',
      cashBalance: 0,
      portfolioValue: 0,
      xirr: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...body,
    };
    mockClients.push(client as any);
    return ok(client, 201);
  }

  if (/\/clients\/[^/]+$/.test(url) && method === 'patch') {
    const id = url.split('/').pop();
    const idx = mockClients.findIndex((c) => c.id === id);
    if (idx < 0) return err(404, `Client ${id} not found`);
    // Merge the patch onto the stored client and hand the whole record back, the
    // same shape the real PATCH returns — this is what the Set Cash modal reads
    // to refresh every cash figure after a balance edit.
    const updated = { ...mockClients[idx], ...body };
    mockClients[idx] = updated as any;
    return ok(updated);
  }

  if (/\/clients\/[^/]+$/.test(url) && method === 'delete') {
    const id = url.split('/').pop();
    const idx = mockClients.findIndex((c) => c.id === id);
    if (idx < 0) return err(404, `Client ${id} not found`);
    mockClients.splice(idx, 1);
    return ok({ success: true, id });
  }

  // --- Holdings ---
  // Sample template: without xlsx on the client, mock mode serves a CSV with
  // the same columns the real .xlsx template uses. It still imports fine.
  if (url.endsWith('/holdings/import/template') && method === 'get') {
    const headers = [
      'clientId', 'ticker', 'quantity', 'averageCost', 'currentPrice',
      'company', 'sector', 'industry', 'country', 'exchange',
      'theme', 'targetWeight', 'notes',
    ];
    const example = [
      'client-1', 'AAPL', '100', '150', '175',
      'Apple Inc.', 'Technology', 'Consumer Electronics', 'United States', 'NASDAQ',
      '', '5', 'Optional free-text note',
    ];
    const csv = `${headers.join(',')}\n${example.join(',')}\n`;
    return ok(new Blob([csv], { type: 'text/csv' }));
  }

  // Bulk import: the backend parses the file; mock mode can't (no xlsx on the
  // client), so it reports that it's mocked rather than pretending to import.
  if (url.endsWith('/holdings/import') && method === 'post') {
    return ok({
      total: 0,
      imported: 0,
      failed: 0,
      results: [],
      mock: true,
    });
  }

  if (url.endsWith('/holdings') && method === 'get') {
    return ok(mockHoldings);
  }
  if (url.endsWith('/holdings') && method === 'post') {
    const qty = Number(body.quantity) || 0;
    const price = Number(body.currentPrice ?? body.averageCost) || 0;
    const holding = {
      id: genId(),
      marketValue: qty * price,
      unrealizedPnL: 0,
      realizedPnL: 0,
      allocationPercent: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...body,
      client: mockClients.find((c) => c.id === body.clientId),
    };
    mockHoldings.push(holding as any);
    return ok(holding);
  }

  // --- Transactions ---
  if (url.endsWith('/transactions') && method === 'get') {
    return ok(mockTransactions);
  }

  // --- Watchlist ---
  // Prices and MTD/QTD/YTD returns require live market data, so — like
  // /market/lookup — every /watchlist route falls through to the real
  // backend instead of a static fixture.

  return undefined; // not mocked -> hit the network
}

function safeParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

class APIClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((config) => {
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }

      // Resolve from in-memory mock data without ever hitting the network.
      if (USE_MOCK) {
        const mocked = handleMock(config);
        if (mocked !== undefined) {
          // Short-circuit axios via its adapter so no request is sent.
          config.adapter = () =>
            mocked.__mockError
              ? Promise.reject(mocked.__mockError)
              : Promise.resolve(mocked);
        }
      }

      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;

          if (this.refreshToken) {
            try {
              const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
                refreshToken: this.refreshToken,
              });

              this.setTokens(response.data);
              originalRequest.headers.Authorization = `Bearer ${this.accessToken}`;
              return this.client(originalRequest);
            } catch (refreshError) {
              this.clearTokens();
              window.location.href = '/auth/login';
            }
          }
        }

        return Promise.reject(error);
      }
    );

    this.loadTokens();
  }

  private loadTokens() {
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem('accessToken');
      this.refreshToken = localStorage.getItem('refreshToken');
    }
  }

  setTokens(tokens: AuthToken) {
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;

    if (typeof window !== 'undefined') {
      localStorage.setItem('accessToken', tokens.accessToken);
      localStorage.setItem('refreshToken', tokens.refreshToken);
    }
  }

  clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;

    if (typeof window !== 'undefined') {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
    }
  }

  getClient() {
    return this.client;
  }
}

export const apiClient = new APIClient();
