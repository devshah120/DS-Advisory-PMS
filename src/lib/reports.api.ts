import { apiClient } from './api';
import {
  ClientFeeRow,
  FeeQuarterOption,
  CapitalGainsReport,
  FamilyFeeInvoice,
  InvoiceableFamily,
} from '@/types/reports';
import type { Market } from './market-scope';

export const reportsApi = {
  /** The quarter dropdown's options, newest first. */
  async feeQuarters(): Promise<FeeQuarterOption[]> {
    const res = await apiClient.getClient().get<FeeQuarterOption[]>('/reports/fees/quarters');
    return res.data;
  },

  /**
   * Fee rows for `quarter` (e.g. "Q3-CY26"); omitted means the current quarter.
   * `market` scopes to one book — the table sums a total, and mixing books
   * would total two currencies together.
   */
  async fees(quarter?: string, market?: Market): Promise<ClientFeeRow[]> {
    const res = await apiClient.getClient().get<ClientFeeRow[]>('/reports/fees', {
      params: { ...(quarter ? { quarter } : {}), ...(market ? { market } : {}) },
    });
    return res.data;
  },


  /** The households this manager can invoice, for the fee page's selector. */
  async invoiceableFamilies(market?: Market): Promise<InvoiceableFamily[]> {
    const res = await apiClient
      .getClient()
      .get<InvoiceableFamily[]>('/reports/fees/families', {
        params: market ? { market } : undefined,
      });
    return res.data;
  },

  /**
   * One household's invoice for a quarter — the member fee lines plus the
   * household total, ready to send to the family.
   *
   * No `market` param: the backend reads the book off the FAMILY record, which
   * cannot go stale the way a value passed from the UI's market toggle can.
   */
  async familyInvoice(familyId: string, quarter?: string): Promise<FamilyFeeInvoice> {
    const res = await apiClient
      .getClient()
      .get<FamilyFeeInvoice>(`/reports/fees/family/${familyId}`, {
        params: quarter ? { quarter } : {},
      });
    return res.data;
  },

  /**
   * One client's FIFO capital-gains statement.
   *
   * `fiscalYear` is the full four-digit year (2027), not the label's two digits —
   * "FY27" is a display form only. Omitted means the most recent year with
   * realized activity, so the page opens on data rather than an empty state.
   */
  async capitalGains(clientId: string, fiscalYear?: number): Promise<CapitalGainsReport> {
    const res = await apiClient
      .getClient()
      .get<CapitalGainsReport>(`/reports/capital-gains/${clientId}`, {
        params: fiscalYear ? { fiscalYear } : {},
      });
    return res.data;
  },

  /** The fiscal-year dropdown options for one client, newest first. */
  async capitalGainsYears(clientId: string): Promise<number[]> {
    const res = await apiClient
      .getClient()
      .get<number[]>(`/reports/capital-gains/${clientId}/years`);
    return res.data;
  },

  /** @deprecated Use `fees()` — kept so existing callers keep compiling. */
  async currentQuarterFees(): Promise<ClientFeeRow[]> {
    return this.fees();
  },
};
