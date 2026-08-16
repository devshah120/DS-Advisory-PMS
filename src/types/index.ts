import type { Market } from '@/lib/market-scope';

export type { Market };

// Auth Types
//
// `super_admin` is the only role that may manage other users. `admin` is the
// legacy spelling of a full-access staff account, kept so existing rows still
// render; nothing new is created with it.
export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'portfolio_manager'
  | 'research_analyst'
  | 'viewer';

/** Display names, used wherever a role is shown to a person. */
export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  portfolio_manager: 'Portfolio Manager',
  research_analyst: 'Research Analyst',
  viewer: 'Viewer',
};

/**
 * Roles the Users screen may assign. Mirrors ASSIGNABLE_ROLES on the API —
 * `super_admin` is provisioned by script only, so it is absent here too.
 */
export const ASSIGNABLE_ROLES: UserRole[] = [
  'portfolio_manager',
  'research_analyst',
  'viewer',
];

/** Only a Super Admin can reach the Users screen or its endpoints. */
export const isSuperAdmin = (role: UserRole | undefined | null) =>
  role === 'super_admin';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

// Client Types
export type RiskProfile = 'conservative' | 'moderate' | 'aggressive';
export type ClientStatus = 'active' | 'inactive' | 'closed';

/**
 * How the client's XIRR is computed.
 *
 * transactional — every buy is money in and every sell is money out; the return
 *                 is measured on capital deployed into positions.
 * cash_flow     — only the inflows and outflows the client actually gave us;
 *                 trades are internal and do not count as flows.
 */
export type AccountingMethod = 'transactional' | 'cash_flow';

export interface Client {
  id: string;
  name: string;
  broker: string;
  accountNumber: string;
  /** Optional contact email for the mandate. */
  email?: string;
  benchmark: string;
  riskProfile: RiskProfile;
  accountingMethod: AccountingMethod;
  /** Which book this mandate belongs to. Existing clients read back as 'US'. */
  market: Market;
  currency: string;
  status: ClientStatus;
  cashBalance: number;
  portfolioValue: number;
  xirr: number;
  /** Annual management fee, as a percent (e.g. 2 for 2%). Billed quarterly at feeRatePercent / 4. */
  feeRatePercent: number;
  /** The mandate's actual start date — used to prorate the first billing quarter. */
  inceptionDate: Date;
  /** The household this mandate belongs to, if any. Null for a standalone account. */
  familyId?: string | null;
  /** Joined by the API so the list can label a mandate without a second fetch. */
  family?: { id: string; name: string } | null;
  /**
   * The manager whose book this mandate sits in — the firm's privacy boundary.
   *
   * A Portfolio Manager only ever receives their own clients, so this is always
   * their own id for them; it is meaningful mainly to a Super Admin, who sees
   * every book and can reassign a mandate between managers. Null means the
   * mandate is UNASSIGNED and visible to Super Admins only.
   */
  ownerId?: string | null;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A staff member who can hold a book — an option in the "Assigned Manager"
 * selector. Served by GET /users/assignable (Super Admin only).
 */
export interface AssignableManager {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  roleLabel: string;
  organization?: string | null;
}

// Family (household) Types

/**
 * Several client mandates managed as one book — a couple, their children, an
 * HUF. Individual mandates stay first-class; this groups them for reporting.
 */
export interface Family {
  id: string;
  name: string;
  /** A family lives in ONE book: its members' figures share a single currency. */
  market: Market;
  /** ISO 4217 for `market`, so the aggregate renders without re-deriving it. */
  currency: string;
  notes?: string | null;
  memberCount: number;
  members: Array<{ id: string; name: string }>;
  createdAt: Date;
  updatedAt: Date;
}

/** One symbol after merging every account in the household. */
export interface FamilyPosition {
  ticker: string;
  displayTicker: string;
  company: string;
  sector: string;
  industry: string;
  quantity: number;
  /** Cost-weighted across accounts — Σ(qty × avgCost) ÷ Σ(qty). */
  averageCost: number;
  costBasis: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  weight: number;
  realizedPnL: number;
  /** How many of the family's accounts hold it. */
  accounts: number;
  holders: Array<{
    clientId: string;
    clientName: string;
    quantity: number;
    averageCost: number;
    marketValue: number;
    unrealizedPnL: number;
  }>;
}

export interface FamilySectorAllocation {
  sector: string;
  marketValue: number;
  weight: number;
  positions: number;
  unrealizedPnL: number;
}

export interface FamilyAggregate {
  id: string;
  name: string;
  market: Market;
  currency: string;
  members: Array<{
    id: string;
    name: string;
    marketValue: number;
    cashBalance: number;
    portfolioValue: number;
  }>;
  positions: FamilyPosition[];
  sectorAllocation: FamilySectorAllocation[];
  totals: {
    /** Distinct symbols after merging. */
    positionCount: number;
    /** Account-level lots that fed the roll-up, before merging. */
    lotCount: number;
    costBasis: number;
    marketValue: number;
    unrealizedPnL: number;
    unrealizedPnLPercent: number;
    realizedPnL: number;
    cashBalance: number;
    portfolioValue: number;
  };
}

// Holdings Types
export interface Holding {
  id: string;
  clientId: string;
  ticker: string;
  company: string;
  sector: string;
  industry: string;
  country: string;
  theme: string;
  exchange: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  allocationPercent: number;
  unrealizedPnL: number;
  realizedPnL: number;
  dividend: number;
  weight: number;
  targetWeight: number;
  difference: number;
  holdingDays: number;
  investmentThesis?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Transaction Types
export type TransactionType = 'buy' | 'sell' | 'dividend' | 'split' | 'bonus' | 'transfer' | 'cash_deposit' | 'cash_withdrawal' | 'fees';

export interface Transaction {
  id: string;
  clientId: string;
  ticker?: string;
  type: TransactionType;
  quantity?: number;
  price?: number;
  amount: number;
  date: Date;
  description?: string;
  reference?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * An external cash flow recorded for a cash-flow-basis client. It is persisted as
 * an ordinary Transaction (cash_deposit / cash_withdrawal) — the direction here is
 * just the shape of the form, so the operator cannot accidentally file a trade.
 */
export interface CreateCashFlowInput {
  clientId: string;
  direction: 'in' | 'out';
  amount: number;
  date: string;
  description?: string;
  reference?: string;
}

/**
 * A dividend received on a holding. Always positive cash arriving, always tied to
 * a ticker — which is why it has its own form rather than sharing the generic
 * transaction one.
 */
export interface CreateDividendInput {
  clientId: string;
  ticker: string;
  amount: number;
  quantity?: number;
  date: string;
  description?: string;
  reference?: string;
}

// Research Types
export interface Research {
  id: string;
  ticker: string;
  investmentThesis?: string;
  whyBought?: string;
  catalysts?: string;
  risks?: string;
  valuation?: string;
  targetAllocation?: number;
  targetPrice?: number;
  reviewDate?: Date;
  reviewNotes?: string;
  attachments?: string[];
  createdAt: Date;
  updatedAt: Date;
}

// Watchlist Types
export type WatchlistSlot = '1' | '2' | '3' | '4' | '5';

export interface Watchlist {
  id: string;
  slot: WatchlistSlot;
  ticker: string;
  company: string;
  sector: string;
  industry: string;
  /** Which book the name is tracked on. Entries predating this read back 'US'. */
  market: Market;
  createdAt: Date;
  updatedAt: Date;
}

export interface WatchlistFolder {
  slot: WatchlistSlot;
  name: string;
  /** Slot names are per book, so India's "Slot 1" can differ from the US's. */
  market?: Market;
}

export interface BulkAddResult {
  added: Array<{ ticker: string; id: string }>;
  skipped: Array<{ ticker: string; reason: string }>;
}

export interface PeriodReturn {
  baseDate: string | null;
  baseClose: number | null;
  lastDate: string | null;
  lastClose: number | null;
  returnPct: number | null;
}

export interface WatchlistReturns {
  currentPrice: number | null;
  mtd: PeriodReturn;
  qtd: PeriodReturn;
  ytd: PeriodReturn;
}

export interface BenchmarkReturns extends WatchlistReturns {
  code: string;
  label: string;
  symbol: string;
}

export type PortfolioEventType = 'EARNINGS' | 'DIVIDEND' | 'SPLIT';

export interface PortfolioEvent {
  ticker: string;
  company: string;
  clientCount: number;
  type: PortfolioEventType;
  code: 'E' | 'D' | 'C';
  label: string;
  date: string;
  status: 'Upcoming' | 'Confirmed';
  /** The book this ticker trades in — the calendar never mixes the two. */
  market: Market;
  /** Tracked but not yet owned: on the watchlist with no client holding it. */
  watchlistOnly: boolean;
  /**
   * Per-share ANNUAL dividend rate — what the upstream reports, not the amount
   * declared for this specific ex-date. Null for earnings and splits.
   */
  dividendRate: number | null;
  /** Payments per year, when inferable. Gates the per-payment estimate. */
  payoutsPerYear: number | null;
  /** Per-client breakdown behind clientCount, largest holder first. */
  holders: EventHolder[];
  totalQuantity: number;
  totalAnnualAmount: number | null;
  totalEstimatedAmount: number | null;
}

/** Press coverage vs. a regulator-filed exchange disclosure. */
export type NewsKind = 'NEWS' | 'FILING';

/**
 * Materiality tag derived from the headline. Null is the common case and means
 * general coverage — the tags mark the stories that move a position.
 */
export type NewsTag =
  | 'RESULTS'
  | 'BUYBACK'
  | 'M&A'
  | 'DIVIDEND'
  | 'MANAGEMENT'
  | 'RATING'
  | 'ORDER';

/** One story in the News Center feed. */
export interface NewsFeedItem {
  id: string;
  /** Normalized symbol as stored, e.g. 'RELIANCE.NS'. */
  ticker: string;
  /** Display form with the exchange suffix stripped, e.g. 'RELIANCE'. */
  symbol: string;
  company: string;
  market: Market;
  title: string;
  /** Outlet name, or 'BSE' for an exchange filing. */
  publisher: string;
  url: string;
  summary: string | null;
  /** ISO timestamp the story was published upstream. */
  publishedAt: string;
  kind: NewsKind;
  /** Filing category from the exchange. Null for press articles. */
  category: string | null;
  tag: NewsTag | null;
  source: string;
  /** Tracked but not owned — on the watchlist with no client holding it. */
  watchlistOnly: boolean;
  clientCount: number;
}

/** One client's exposure to an event — a row in the Held By hover. */
export interface EventHolder {
  clientId: string;
  clientName: string;
  quantity: number;
  /** `quantity x dividendRate`, this client's annual income from the name. */
  annualAmount: number | null;
  /** The single payment this event represents. Null without a known frequency. */
  estimatedAmount: number | null;
}

// Fundamentals Engine Types
export type FundamentalPillar = 'growth' | 'profitability' | 'financialStrength' | 'valuation' | 'momentum';

export interface MetricScore {
  pillar: FundamentalPillar;
  metric: string;
  value: number | null;
  matchedRange: { min: number; max: number } | null;
  score: number | null;
  weight: number;
  contribution: number;
}

export interface IndustryMetricComparison {
  metric: string;
  company: number | null;
  industryAverage: number | null;
  premiumDiscountPercent: number | null;
}

export interface IndustryComparisonResult {
  industry: string;
  peerCount: number;
  metrics: IndustryMetricComparison[];
}

export interface FundamentalExplanation {
  strengths: string[];
  weaknesses: string[];
}

export interface FundamentalSnapshotData {
  symbol: string;
  company: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  peRatio: number | null;
  forwardPe: number | null;
  pegRatio: number | null;
  evToEbitda: number | null;
  priceToSales: number | null;
  priceToBook: number | null;
  enterpriseValue: number | null;
  revenueQoqPercent: number | null;
  revenueYoyPercent: number | null;
  netProfitQoqPercent: number | null;
  netProfitYoyPercent: number | null;
  revenueCagr3y: number | null;
  netProfitCagr3y: number | null;
  roe: number | null;
  roic: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  interestCoverage: number | null;
  freeCashFlow: number | null;
  lastFourEarningsBeatPercent: number | null;
  nextEarningsDate: string | null;
  dividendYield: number | null;
  dividendPerShare: number | null;
  exDividendDate: string | null;
  paymentDate: string | null;
  refreshedAt: string;
}

export interface FundamentalView {
  symbol: string;
  company: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  strategy: string;
  overallScore: number;
  growthScore: number;
  profitabilityScore: number;
  financialStrengthScore: number;
  valuationScore: number;
  momentumScore: number;
  breakdown: MetricScore[];
  explanation: FundamentalExplanation;
  industryComparison: IndustryComparisonResult | null;
  snapshot: FundamentalSnapshotData;
  computedAt: string;
}

// Dashboard Types
export interface HoldingMover {
  ticker: string;
  /** Suffix-stripped ticker for display — 'RELIANCE.NS' renders as 'RELIANCE'. */
  displayTicker: string;
  company: string;
  clientId: string;
  marketValue: number;
  currentPrice: number;
  changePercent: number;
}

export interface DashboardOverview {
  /**
   * The book these figures describe, echoed back by the server. Read this rather
   * than the local selector when labelling the payload — the selector can be a
   * render ahead of the response it is captioning.
   */
  market: Market;
  /** ISO 4217 for `market` — 'USD' or 'INR'. Drives every currency format here. */
  currency: string;
  totalAUM: number;
  /** House-wide idle cash across every client — deployable buying power, not deployed capital. */
  totalCash: number;
  numClients: number;
  numHoldings: number;
  topGainers: HoldingMover[];
  topLosers: HoldingMover[];
  /** House-wide sector mix across every client's holdings combined, ETFs look-through applied. */
  sectorAllocation: AllocationSlice[];
  /** House-wide holdings grouped by ticker across every client, ranked by combined market value. */
  topHoldings: TopHolding[];
  /** Each client's day change, weighted by their own holdings' market value. */
  clientMovers: ClientMover[];
}

export interface ClientMover {
  clientId: string;
  clientName: string;
  marketValue: number;
  changePercent: number;
}

export interface TopHolding {
  ticker: string;
  displayTicker: string;
  company: string;
  marketValue: number;
  weight: number;
  numClients: number;
}

export interface AllocationSlice {
  key: string;
  value: number;
  weight: number;
}

export interface MarketQuote {
  code: string;
  label: string;
  symbol: string;
  currentPrice: number | null;
  dayChangePercent: number | null;
  ytdChangePercent: number | null;
  /**
   * This quote's own currency. Not the book's: the Indian strip shows Nifty and
   * Sensex in INR next to WTI and gold, which Yahoo quotes in USD for everyone.
   */
  currency: string;
}

// Pagination Types
export interface PaginationParams {
  page: number;
  limit: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
