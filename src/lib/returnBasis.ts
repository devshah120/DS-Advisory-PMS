/**
 * The reporting convention shared by the client and household sheets AND their
 * PDF/XLSX exports.
 *
 * XIRR is an annualized rate by definition, so quoting it over a 45-day window
 * misnames the figure. Windows shorter than a year lead with the absolute
 * money-weighted return over the window (period MWRR); a year or longer leads
 * with XIRR per annum. The benchmark and alpha always follow the headline's
 * basis, so the spread is like-for-like.
 *
 * Lives in lib (not beside the React component) so the export builders bind to
 * the same function the dashboard does. They previously read `benchmark.xirr`
 * directly, which on a 45-day window put an annualized +98.00% benchmark beside
 * a de-annualized -0.61% portfolio return - an alpha that did not reconcile.
 */
export const ANNUALIZE_FROM_DAYS = 365;

export interface ReturnFigures {
  periodDays: number;
  from: string;
  to: string;
  openingValue: number;
  closingValue: number;
  netFlows: number;
  returnPct: number | null;
  annualizedReturnPct: number | null;
  benchmark: { code: string; xirr: number | null; interim: number | null } | null;
  alpha: number | null;
  annualizedAlpha: number | null;
}

export interface ReturnBasis {
  annual: boolean;
  /** Headline portfolio figure on the active basis. */
  portfolio: number | null;
  benchmark: number | null;
  alpha: number | null;
  /** " p.a." on the annualized basis, empty otherwise. */
  suffix: string;
  headlineLabel: string;
}

export function returnBasis(r: ReturnFigures): ReturnBasis {
  const annual = r.periodDays >= ANNUALIZE_FROM_DAYS;
  return annual
    ? {
        annual,
        portfolio: r.annualizedReturnPct,
        benchmark: r.benchmark?.xirr ?? null,
        alpha: r.annualizedAlpha,
        suffix: ' p.a.',
        headlineLabel: 'Annualized return (XIRR)',
      }
    : {
        annual,
        portfolio: r.returnPct,
        benchmark: r.benchmark?.interim ?? null,
        alpha: r.alpha,
        suffix: '',
        headlineLabel: 'Money-weighted period return',
      };
}

export const signedPct = (v: number, dp = 2) => `${v > 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`;
