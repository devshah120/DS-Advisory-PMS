import { apiClient } from './api';
import { clientsApi } from './clients.api';
import { familiesApi } from './families.api';
import type { Client, Family, FamilyAggregate, Holding } from '@/types';
import type { Market } from './market-scope';
import type { RiskPosition } from './riskReportPdf';

/**
 * Loading the subject of a report — one mandate, or one household.
 *
 * Every report on the Reports page asks the same first question: which book of
 * positions am I about? Before this module each answered it privately, which is
 * how a holdings statement and a risk report for the same client end up
 * disagreeing about the position count — one filtered closed lots, the other
 * did not.
 *
 * So the loading, the closed-lot filter and the shape conversion live here
 * once, and the reports differ only in what they DO with the positions.
 */

/**
 * Fractional lots are ordinary (a 0.89-share reinvestment), so a closed
 * position is one whose quantity has rounded to nothing rather than one that is
 * exactly zero. Matches CLOSED_POSITION_EPSILON on the holdings page.
 */
const CLOSED_POSITION_EPSILON = 1e-9;

function openOnly<T extends { quantity: number }>(rows: T[]): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((h) => Math.abs(Number(h.quantity) || 0) > CLOSED_POSITION_EPSILON);
}

/** A report's subject: a single mandate or a whole household. */
export type SubjectKind = 'client' | 'family';

/** The prefixed value a subject selector carries, e.g. 'family:ckx…'. */
export type SubjectValue = string;

export interface SubjectOption {
  value: SubjectValue;
  kind: SubjectKind;
  id: string;
  label: string;
  /** Member count for a household; undefined for a mandate. */
  memberCount?: number;
}

/**
 * Everything a report needs about its subject, already normalised.
 *
 * The three reports read the same fields — that is the point. A holdings
 * statement and a risk report built from one of these cannot disagree about
 * what the portfolio contains.
 */
export interface SubjectData {
  kind: SubjectKind;
  id: string;
  name: string;
  currency: string;
  positions: RiskPosition[];
  cashBalance: number;
  /** Invested value only — cash is carried separately, never folded in. */
  investedValue: number;
  portfolioValue: number;
  /** Number of member accounts, for a household. */
  memberCount?: number;
  /**
   * How many of the household's accounts hold each symbol, keyed by symbol.
   * Empty for a single mandate, where every answer would trivially be 1.
   */
  accountsBySymbol: Record<string, number>;
}

/** Encodes/decodes the prefixed selector value. */
export function encodeSubject(kind: SubjectKind, id: string): SubjectValue {
  return `${kind}:${id}`;
}

export function decodeSubject(value: SubjectValue): { kind: SubjectKind; id: string } | null {
  const [kind, ...rest] = value.split(':');
  const id = rest.join(':');
  if (!id || (kind !== 'client' && kind !== 'family')) return null;
  return { kind, id };
}

/**
 * The subjects a report can be run for, in one book.
 *
 * Households are listed first: a firm that has grouped accounts into a family
 * almost always reports at that level, and burying the household under thirty
 * individual mandates makes the common case the hard one. A failure to load
 * families degrades to mandates alone rather than failing the picker — the
 * individual statement is the report's primary job.
 */
export async function loadSubjectOptions(market: Market): Promise<SubjectOption[]> {
  const [clients, families] = await Promise.all([
    clientsApi.list({ limit: 500, market }),
    familiesApi.list(market).catch(() => [] as Family[]),
  ]);

  const familyOptions: SubjectOption[] = families.map((f) => ({
    value: encodeSubject('family', f.id),
    kind: 'family',
    id: f.id,
    label: `${f.name} (household · ${f.memberCount} account${f.memberCount === 1 ? '' : 's'})`,
    memberCount: f.memberCount,
  }));

  const clientOptions: SubjectOption[] = clients.map((c: Client) => ({
    value: encodeSubject('client', c.id),
    kind: 'client',
    id: c.id,
    label: c.name,
  }));

  return [...familyOptions, ...clientOptions];
}

/** One mandate's open positions, from the book-wide holdings endpoint. */
async function loadClientSubject(clientId: string, market: Market): Promise<SubjectData> {
  const [client, holdingsRes] = await Promise.all([
    clientsApi.get(clientId),
    apiClient.getClient().get<Holding[]>('/holdings', { params: { market } }),
  ]);

  // The endpoint serves the whole book, so the client's own rows are filtered
  // here. Asking for every position and narrowing locally costs one request
  // rather than one per client, and the report only ever needs one client.
  const rows = openOnly(
    (Array.isArray(holdingsRes.data) ? holdingsRes.data : []).filter(
      (h) => h.clientId === clientId,
    ),
  );

  const positions: RiskPosition[] = rows
    .map((h) => {
      const costBasis = h.averageCost * h.quantity;
      const currentValue = h.marketValue ?? h.quantity * h.currentPrice;
      const pl = currentValue - costBasis;
      return {
        symbol: h.ticker,
        name: h.company,
        sector: h.sector || 'Unclassified',
        quantity: h.quantity,
        currentValue,
        costBasis,
        pl,
        // Recomputed rather than trusting the row's own percent: a position
        // with no recorded cost basis would otherwise report a return on zero.
        plPercent: costBasis ? (pl / costBasis) * 100 : 0,
      };
    })
    .sort((a, b) => b.currentValue - a.currentValue);

  const investedValue = positions.reduce((s, p) => s + p.currentValue, 0);
  const cashBalance = Number(client.cashBalance) || 0;

  return {
    kind: 'client',
    id: clientId,
    name: client.name,
    currency: client.currency || (market === 'INDIA' ? 'INR' : 'USD'),
    positions,
    cashBalance,
    investedValue,
    portfolioValue: investedValue + cashBalance,
    accountsBySymbol: {},
  };
}

/**
 * A household's merged book, from the server's own aggregate.
 *
 * Deliberately NOT assembled here from the members' individual holdings: the
 * server merges lots across accounts with a cost-weighted average, applies the
 * ownership boundary, and reports the household's cash as one figure. Rebuilding
 * that in the browser is how a family report and the family drawer end up
 * quoting different average costs for the same symbol.
 */
async function loadFamilySubject(familyId: string): Promise<SubjectData> {
  const agg: FamilyAggregate = await familiesApi.aggregate(familyId);

  const positions: RiskPosition[] = openOnly(agg.positions ?? [])
    .map((p) => ({
      symbol: p.displayTicker || p.ticker,
      name: p.company,
      sector: p.sector || 'Unclassified',
      quantity: p.quantity,
      currentValue: p.marketValue,
      costBasis: p.costBasis,
      pl: p.unrealizedPnL,
      plPercent: p.costBasis ? (p.unrealizedPnL / p.costBasis) * 100 : 0,
    }))
    .sort((a, b) => b.currentValue - a.currentValue);

  const accountsBySymbol: Record<string, number> = {};
  for (const p of agg.positions ?? []) {
    accountsBySymbol[p.displayTicker || p.ticker] = p.accounts;
  }

  return {
    kind: 'family',
    id: familyId,
    name: agg.name,
    currency: agg.currency,
    positions,
    cashBalance: agg.totals.cashBalance,
    investedValue: agg.totals.marketValue,
    portfolioValue: agg.totals.portfolioValue,
    memberCount: agg.members?.length ?? 0,
    accountsBySymbol,
  };
}

/** Loads whichever subject the selector names. */
export function loadSubject(
  subject: { kind: SubjectKind; id: string },
  market: Market,
): Promise<SubjectData> {
  return subject.kind === 'family'
    ? loadFamilySubject(subject.id)
    : loadClientSubject(subject.id, market);
}
