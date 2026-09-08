import { apiClient } from './api';
import type { Market } from './market-scope';

/**
 * Corporate Action Engine client.
 *
 * Mirrors the backend's own vocabulary exactly — no renaming, no reshaping —
 * so a field that looks wrong on screen can be traced to one API response and
 * one service method rather than through a translation layer.
 */

export type CorporateActionType =
  | 'STOCK_SPLIT'
  | 'REVERSE_SPLIT'
  | 'BONUS_ISSUE'
  | 'SPECIAL_DIVIDEND'
  | 'DIVIDEND'
  | 'STOCK_DIVIDEND'
  | 'RIGHTS_ISSUE'
  | 'SPIN_OFF'
  | 'MERGER'
  | 'ACQUISITION'
  | 'TICKER_CHANGE'
  | 'NAME_CHANGE'
  | 'EXCHANGE_CHANGE'
  | 'DELISTING'
  | 'CASH_DISTRIBUTION'
  | 'RETURN_OF_CAPITAL';

export type CorporateActionStatus =
  | 'DETECTED'
  | 'PENDING_VALIDATION'
  | 'VALIDATED'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PROCESSING'
  | 'PROCESSED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FAILED';

export type SourceTier =
  | 'COMPANY_IR'
  | 'REGULATORY_FILING'
  | 'EXCHANGE'
  | 'PRIMARY_API'
  | 'SECONDARY_API'
  | 'UNVERIFIED';

export interface SourceReference {
  source: string;
  tier: SourceTier;
  url?: string | null;
  reference?: string | null;
  fetchedAt: string;
  payload?: Record<string, unknown>;
}

export interface ValidationFinding {
  code: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  field?: string;
}

export interface CorporateAction {
  id: string;
  symbol: string;
  company: string | null;
  market: Market;
  actionType: CorporateActionType;

  announcementDate: string | null;
  declarationDate: string | null;
  recordDate: string | null;
  exDate: string | null;
  effectiveDate: string;
  paymentDate: string | null;
  processingDate: string | null;

  oldRatio: number | null;
  newRatio: number | null;
  /** Display form, already inverted by the API ('2:1' for a 2-for-1). */
  ratioLabel: string | null;

  cashAmount: number | null;
  currency: string | null;

  newSymbol: string | null;
  newCompany: string | null;
  details: Record<string, unknown> | null;

  source: string;
  sourceUrl: string | null;
  sources: SourceReference[];

  status: CorporateActionStatus;
  confidenceScore: number;
  hasConflict: boolean;
  conflicts: Array<{ field: string; values: Array<{ source: string; value: unknown }> }> | null;

  validationErrors: ValidationFinding[] | null;
  validatedAt: string | null;

  /** Counted within the caller's own book — see the API's scoping note. */
  affectedClients: number;
  affectedShares: number;
  processedClients: number;
  firmWideView: boolean;

  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientImpact {
  clientId: string;
  clientName: string;
  symbol: string;
  quantityBefore: number;
  quantityAfter: number;
  averageCostBefore: number;
  averageCostAfter: number;
  marketValueBefore: number;
  marketValueAfter: number;
  cashImpact: number;
  currency: string;
  fractionalShares: number;
  status: string;
  errorMessage?: string | null;
  note?: string | null;
}

export interface CorporateActionPreview {
  corporateActionId: string;
  symbol: string;
  company: string | null;
  actionType: CorporateActionType;
  ratioLabel: string | null;
  affectedClients: number;
  sharesBefore: number;
  sharesAfter: number;
  averageCostBefore: number | null;
  averageCostAfter: number | null;
  portfolioValueBefore: number;
  portfolioValueAfter: number;
  portfolioValueImpact: number;
  cashImpact: number;
  performanceImpact: number;
  clients: ClientImpact[];
  warnings: string[];
}

export interface LedgerEntry {
  id: string;
  clientId: string;
  client: { name: string };
  symbol: string;
  quantityBefore: number;
  quantityAfter: number;
  averageCostBefore: number;
  averageCostAfter: number;
  marketValueBefore: number;
  marketValueAfter: number;
  cashImpact: number;
  currency: string;
  fractionalShares: number;
  status: 'PENDING' | 'APPLIED' | 'FAILED' | 'REVERSED';
  errorMessage: string | null;
  processedAt: string;
}

export interface AuditEntry {
  id: string;
  corporateActionId: string;
  action: string;
  userId: string | null;
  actorLabel: string;
  beforeValue: unknown;
  afterValue: unknown;
  source: string | null;
  ipAddress: string | null;
  reason: string | null;
  createdAt: string;
}

export interface CorporateActionDetail extends CorporateAction {
  ledger: LedgerEntry[];
  audit: AuditEntry[];
}

export interface ReconciliationResult {
  status: 'RECONCILED' | 'RECONCILIATION_FAILED' | 'NOT_APPLICABLE';
  expectedShares: number;
  actualShares: number;
  variance: number;
  message?: string;
}

export interface ProcessingResult {
  corporateActionId: string;
  clientsProcessed: number;
  transactionsCreated: number;
  totalSharesBefore: number;
  totalSharesAfter: number;
  totalCashImpact: number;
  reconciliation: ReconciliationResult;
}

export interface CorporateActionSummary {
  counts: Partial<Record<CorporateActionStatus, number>>;
  pendingReview: number;
  failed: number;
  processed: number;
  supportedTypes: CorporateActionType[];
}

export interface CorporateActionSettings {
  autoProcessEnabled: boolean;
  minimumConfidenceScore: number;
  fractionalSharePolicy: 'RETAIN' | 'CASH_IN_LIEU' | 'ROUND_DOWN';
  cashInLieuPolicy: 'MARKET_PRICE' | 'COST_BASIS';
  notificationEnabled: boolean;
  processingHourUtc: number;
  sourcePriority: string[];
}

export interface SweepResult {
  fetched: number;
  created: number;
  merged: number;
  validated: number;
  autoProcessed: number;
  pendingReview: number;
  conflicts: number;
  errors: string[];
  providers: Array<{ name: string; fetched: number; failed: boolean }>;
}

export interface CreateCorporateActionInput {
  symbol: string;
  company?: string;
  actionType: CorporateActionType;
  effectiveDate: string;
  announcementDate?: string;
  recordDate?: string;
  exDate?: string;
  paymentDate?: string;
  /**
   * PART 6 storage convention: each `oldRatio` shares become `newRatio`.
   * The entry form converts from the spoken "2 : 1" before submitting, so a
   * caller building this object by hand is the only one who needs to know.
   */
  oldRatio?: number;
  newRatio?: number;
  cashAmount?: number;
  currency?: string;
  newSymbol?: string;
  newCompany?: string;
  details?: Record<string, unknown>;
  source: string;
  tier: SourceTier;
  sourceUrl?: string;
  notes?: string;
}

export interface ListFilters {
  status?: CorporateActionStatus;
  actionType?: CorporateActionType;
  market?: Market;
  symbol?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export const corporateActionsApi = {
  async list(filters: ListFilters = {}): Promise<CorporateAction[]> {
    const res = await apiClient
      .getClient()
      .get<CorporateAction[]>('/corporate-actions', { params: filters });
    return res.data;
  },

  async summary(): Promise<CorporateActionSummary> {
    const res = await apiClient.getClient().get<CorporateActionSummary>('/corporate-actions/summary');
    return res.data;
  },

  async detail(id: string): Promise<CorporateActionDetail> {
    const res = await apiClient.getClient().get<CorporateActionDetail>(`/corporate-actions/${id}`);
    return res.data;
  },

  /** PART 39/40 — what processing would do, computed without writing. */
  async preview(id: string): Promise<CorporateActionPreview> {
    const res = await apiClient
      .getClient()
      .get<CorporateActionPreview>(`/corporate-actions/${id}/preview`);
    return res.data;
  },

  async create(input: CreateCorporateActionInput) {
    const res = await apiClient.getClient().post('/corporate-actions', input);
    return res.data as {
      action: CorporateActionDetail;
      created: boolean;
      merged: boolean;
      validation: { valid: boolean; findings: ValidationFinding[] };
    };
  },

  async validate(id: string): Promise<{ valid: boolean; findings: ValidationFinding[] }> {
    const res = await apiClient.getClient().post(`/corporate-actions/${id}/validate`);
    return res.data;
  },

  async approve(id: string): Promise<CorporateAction> {
    const res = await apiClient.getClient().post<CorporateAction>(`/corporate-actions/${id}/approve`);
    return res.data;
  },

  async reject(id: string, reason: string): Promise<CorporateAction> {
    const res = await apiClient
      .getClient()
      .post<CorporateAction>(`/corporate-actions/${id}/reject`, { reason });
    return res.data;
  },

  /** Applies the action to every affected client, atomically. */
  async process(id: string): Promise<ProcessingResult> {
    const res = await apiClient
      .getClient()
      .post<ProcessingResult>(`/corporate-actions/${id}/process`);
    return res.data;
  },

  /** Manual provider sweep. The only route that spends provider budget. */
  async sync(): Promise<SweepResult> {
    const res = await apiClient.getClient().post<SweepResult>('/corporate-actions/sync');
    return res.data;
  },

  async settings(): Promise<CorporateActionSettings> {
    const res = await apiClient
      .getClient()
      .get<CorporateActionSettings>('/corporate-actions/settings');
    return res.data;
  },

  async updateSettings(
    patch: Partial<Omit<CorporateActionSettings, 'sourcePriority'>>,
  ): Promise<CorporateActionSettings> {
    const res = await apiClient
      .getClient()
      .patch<CorporateActionSettings>('/corporate-actions/settings', patch);
    return res.data;
  },
};

// ── display helpers ─────────────────────────────────────────────────────────

/**
 * Badge codes from PART 54. Kept here rather than in the page so the Event
 * Center and the Corporate Actions page cannot label the same event
 * differently.
 */
export const ACTION_CODE: Record<CorporateActionType, string> = {
  STOCK_SPLIT: 'S',
  REVERSE_SPLIT: 'S',
  BONUS_ISSUE: 'B',
  STOCK_DIVIDEND: 'B',
  DIVIDEND: 'D',
  SPECIAL_DIVIDEND: 'D',
  CASH_DISTRIBUTION: 'D',
  RETURN_OF_CAPITAL: 'D',
  RIGHTS_ISSUE: 'R',
  SPIN_OFF: 'M',
  MERGER: 'M',
  ACQUISITION: 'M',
  TICKER_CHANGE: 'T',
  NAME_CHANGE: 'T',
  EXCHANGE_CHANGE: 'T',
  DELISTING: 'C',
};

export const ACTION_LABEL: Record<CorporateActionType, string> = {
  STOCK_SPLIT: 'Stock Split',
  REVERSE_SPLIT: 'Reverse Split',
  BONUS_ISSUE: 'Bonus Issue',
  STOCK_DIVIDEND: 'Stock Dividend',
  DIVIDEND: 'Dividend',
  SPECIAL_DIVIDEND: 'Special Dividend',
  CASH_DISTRIBUTION: 'Cash Distribution',
  RETURN_OF_CAPITAL: 'Return of Capital',
  RIGHTS_ISSUE: 'Rights Issue',
  SPIN_OFF: 'Spin-off',
  MERGER: 'Merger',
  ACQUISITION: 'Acquisition',
  TICKER_CHANGE: 'Ticker Change',
  NAME_CHANGE: 'Name Change',
  EXCHANGE_CHANGE: 'Exchange Change',
  DELISTING: 'Delisting',
};

export const SOURCE_TIER_LABEL: Record<SourceTier, string> = {
  COMPANY_IR: 'Official IR',
  REGULATORY_FILING: 'SEC / Exchange Filing',
  EXCHANGE: 'Exchange',
  PRIMARY_API: 'Primary Market Data',
  SECONDARY_API: 'Secondary Market Data',
  UNVERIFIED: 'Unverified',
};

/** PART 8's Confidence column: the number, said in words. */
export function confidenceLabel(score: number): {
  label: string;
  tone: 'success' | 'warning' | 'danger';
} {
  if (score >= 90) return { label: 'High Confidence', tone: 'success' };
  if (score >= 70) return { label: 'Medium Confidence', tone: 'warning' };
  return { label: 'Low Confidence', tone: 'danger' };
}

/** Which statuses still need a human. Drives the review queue's default filter. */
export const REVIEW_STATUSES: CorporateActionStatus[] = [
  'DETECTED',
  'PENDING_VALIDATION',
  'VALIDATED',
  'PENDING_APPROVAL',
];

export function isActionable(status: CorporateActionStatus): boolean {
  return REVIEW_STATUSES.includes(status) || status === 'APPROVED' || status === 'FAILED';
}
