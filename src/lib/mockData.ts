// In-memory mock backend so the app runs fully WITHOUT the API/database.
// Toggle with NEXT_PUBLIC_USE_MOCK ("false" to use the real backend).
import { Client, Holding, Transaction } from '@/types';

const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86400000);

// ---- Seed data ---------------------------------------------------------

export const mockClients: Client[] = [
  {
    id: 'client-1',
    name: 'Evergreen Capital',
    broker: 'Interactive Brokers',
    accountNumber: 'U1234567',
    benchmark: 'S&P 500',
    riskProfile: 'moderate',
    accountingMethod: 'cash_flow',
    currency: 'USD',
    status: 'active',
    cashBalance: 125000,
    portfolioValue: 1875000,
    xirr: 14.2,
    feeRatePercent: 2,
    inceptionDate: daysAgo(420),
    notes: 'Long-term growth mandate.',
    createdAt: daysAgo(420),
    updatedAt: daysAgo(2),
  },
  {
    id: 'client-2',
    name: 'Hudson Family Office',
    broker: 'Fidelity',
    accountNumber: 'Z7654321',
    benchmark: 'Nasdaq 100',
    riskProfile: 'aggressive',
    accountingMethod: 'transactional',
    currency: 'USD',
    status: 'active',
    cashBalance: 340000,
    portfolioValue: 4210000,
    xirr: 21.7,
    feeRatePercent: 1.5,
    inceptionDate: daysAgo(610),
    notes: 'Tech-tilted, high conviction.',
    createdAt: daysAgo(610),
    updatedAt: daysAgo(5),
  },
  {
    id: 'client-3',
    name: 'Maple Trust',
    broker: 'Charles Schwab',
    accountNumber: 'S2468013',
    benchmark: 'MSCI World',
    riskProfile: 'conservative',
    accountingMethod: 'cash_flow',
    currency: 'USD',
    status: 'active',
    cashBalance: 95000,
    portfolioValue: 980000,
    xirr: 8.9,
    feeRatePercent: 1,
    inceptionDate: daysAgo(300),
    notes: 'Capital preservation focus.',
    createdAt: daysAgo(300),
    updatedAt: daysAgo(1),
  },
];

const mkHolding = (h: Partial<Holding> & {
  id: string; clientId: string; ticker: string; company: string;
  sector: string; quantity: number; averageCost: number; currentPrice: number;
}): Holding => {
  const marketValue = h.quantity * h.currentPrice;
  const cost = h.quantity * h.averageCost;
  return {
    industry: '',
    country: 'USA',
    theme: '',
    exchange: 'NASDAQ',
    allocationPercent: 0,
    unrealizedPnL: marketValue - cost,
    realizedPnL: 0,
    dividend: 0,
    weight: 0,
    targetWeight: 0,
    difference: 0,
    holdingDays: 200,
    marketValue,
    createdAt: daysAgo(200),
    updatedAt: daysAgo(1),
    ...h,
  } as Holding;
};

export const mockHoldings: (Holding & { client?: Client })[] = [
  mkHolding({ id: 'h1', clientId: 'client-1', ticker: 'AAPL', company: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', quantity: 1200, averageCost: 150, currentPrice: 212 }),
  mkHolding({ id: 'h2', clientId: 'client-1', ticker: 'MSFT', company: 'Microsoft Corp.', sector: 'Technology', industry: 'Software', quantity: 600, averageCost: 280, currentPrice: 430 }),
  mkHolding({ id: 'h3', clientId: 'client-1', ticker: 'JNJ', company: 'Johnson & Johnson', sector: 'Healthcare', industry: 'Pharma', quantity: 500, averageCost: 165, currentPrice: 152 }),
  mkHolding({ id: 'h4', clientId: 'client-2', ticker: 'NVDA', company: 'NVIDIA Corp.', sector: 'Technology', industry: 'Semiconductors', quantity: 900, averageCost: 95, currentPrice: 178 }),
  mkHolding({ id: 'h5', clientId: 'client-2', ticker: 'AMZN', company: 'Amazon.com Inc.', sector: 'Consumer Discretionary', industry: 'E-Commerce', quantity: 700, averageCost: 140, currentPrice: 198 }),
  mkHolding({ id: 'h6', clientId: 'client-2', ticker: 'TSLA', company: 'Tesla Inc.', sector: 'Consumer Discretionary', industry: 'Autos', quantity: 800, averageCost: 250, currentPrice: 215 }),
  mkHolding({ id: 'h7', clientId: 'client-3', ticker: 'BRK.B', company: 'Berkshire Hathaway', sector: 'Financials', industry: 'Insurance', quantity: 300, averageCost: 320, currentPrice: 415 }),
  mkHolding({ id: 'h8', clientId: 'client-3', ticker: 'PG', company: 'Procter & Gamble', sector: 'Consumer Staples', industry: 'Household', quantity: 400, averageCost: 145, currentPrice: 168 }),
];

// attach client object for convenience
mockHoldings.forEach((h) => {
  h.client = mockClients.find((c) => c.id === h.clientId);
});

export const mockTransactions: Transaction[] = [
  { id: 't1', clientId: 'client-1', ticker: 'AAPL', type: 'buy', quantity: 200, price: 205, amount: 41000, date: daysAgo(3), createdAt: daysAgo(3), updatedAt: daysAgo(3) },
  { id: 't2', clientId: 'client-2', ticker: 'NVDA', type: 'sell', quantity: 100, price: 178, amount: 17800, date: daysAgo(6), createdAt: daysAgo(6), updatedAt: daysAgo(6) },
  { id: 't3', clientId: 'client-1', type: 'dividend', amount: 3200, date: daysAgo(9), createdAt: daysAgo(9), updatedAt: daysAgo(9) },
  { id: 't4', clientId: 'client-3', type: 'cash_deposit', amount: 50000, date: daysAgo(12), createdAt: daysAgo(12), updatedAt: daysAgo(12) },
  { id: 't5', clientId: 'client-2', ticker: 'TSLA', type: 'buy', quantity: 150, price: 215, amount: 32250, date: daysAgo(15), createdAt: daysAgo(15), updatedAt: daysAgo(15) },
];

