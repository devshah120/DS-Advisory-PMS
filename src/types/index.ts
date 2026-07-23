// Auth Types
export type UserRole = 'admin' | 'portfolio_manager' | 'research_analyst' | 'viewer';

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
  currency: string;
  status: ClientStatus;
  cashBalance: number;
  portfolioValue: number;
  xirr: number;
  /** Annual management fee, as a percent (e.g. 2 for 2%). Billed quarterly at feeRatePercent / 4. */
  feeRatePercent: number;
  /** The mandate's actual start date — used to prorate the first billing quarter. */
  inceptionDate: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface WatchlistFolder {
  slot: WatchlistSlot;
  name: string;
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
  company: string;
  clientId: string;
  marketValue: number;
  currentPrice: number;
  changePercent: number;
}

export interface DashboardOverview {
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
}

export interface TopHolding {
  ticker: string;
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
