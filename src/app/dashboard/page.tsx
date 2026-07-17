'use client';

import { useEffect, useState } from 'react';
import { Landmark, Users, TrendingUp, TrendingDown, Briefcase } from 'lucide-react';
import { dashboardApi } from '@/lib/dashboard.api';
import { formatCompactCurrency, formatSignedPct, cn } from '@/lib/utils';
import { DashboardOverview, MarketQuote, HoldingMover } from '@/types';
import AppShell from '@/components/layout/AppShell';
import { Card, CardHeader, StatCard, Skeleton, useToast } from '@/components/ui';

export default function DashboardPage() {
  const { toast } = useToast();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [market, setMarket] = useState<MarketQuote[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    dashboardApi
      .overview()
      .then((data) => mounted && setOverview(data))
      .catch(() => mounted && toast({ tone: 'error', title: 'Failed to load portfolio overview' }))
      .finally(() => mounted && setOverviewLoading(false));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let mounted = true;
    dashboardApi
      .marketOverview()
      .then((data) => mounted && setMarket(data))
      .catch(() => mounted && toast({ tone: 'error', title: 'Failed to load market overview' }))
      .finally(() => mounted && setMarketLoading(false));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const indices = market.slice(0, 4);
  const commodities = market.slice(4);

  return (
    <AppShell title="Portfolio Overview" subtitle="Consolidated performance across all managed accounts">
      <div className="space-y-6">
        {/* ---- KPI row ---- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {overviewLoading || !overview ? (
            <>
              <KpiSkeleton />
              <KpiSkeleton />
              <KpiSkeleton />
            </>
          ) : (
            <>
              <StatCard
                index={0}
                label="Total AUM"
                value={overview.totalAUM}
                format={(n) => formatCompactCurrency(n)}
                icon={<Landmark className="h-4 w-4" />}
                accent="brand"
              />
              <StatCard
                index={1}
                label="Total Clients"
                value={overview.numClients}
                format={(n) => String(n)}
                icon={<Users className="h-4 w-4" />}
                accent="neutral"
              />
              <StatCard
                index={2}
                label="Holdings"
                value={overview.numHoldings}
                format={(n) => String(n)}
                icon={<Briefcase className="h-4 w-4" />}
                accent="neutral"
              />
            </>
          )}
        </div>

        {/* ---- Gainers / losers ---- */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MoverCard title="Top Gainers" rows={overview?.topGainers} loading={overviewLoading} positive />
          <MoverCard title="Top Losers" rows={overview?.topLosers} loading={overviewLoading} positive={false} />
        </div>

        {/* ---- Market overview ---- */}
        <Card>
          <CardHeader title="Market Overview" subtitle="Indices and commodities, daily and year-to-date" />
          <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Indices</p>
              <QuoteTable quotes={indices} loading={marketLoading} />
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-tertiary">Commodities</p>
              <QuoteTable quotes={commodities} loading={marketLoading} />
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function KpiSkeleton() {
  return (
    <div className="card p-5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-7 w-32" />
    </div>
  );
}

function MoverCard({
  title,
  rows,
  loading,
  positive,
}: {
  title: string;
  rows?: HoldingMover[];
  loading: boolean;
  positive: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        subtitle="1-day change across all holdings"
        action={
          positive ? (
            <TrendingUp className="h-4 w-4 text-success" />
          ) : (
            <TrendingDown className="h-4 w-4 text-danger" />
          )
        }
      />
      <div className="mt-4 space-y-1">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between py-2.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))
        ) : !rows || rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-tertiary">No data available</p>
        ) : (
          rows.map((row) => (
            <div key={row.ticker + row.clientId} className="flex items-center justify-between border-b border-border py-2.5 last:border-0">
              <div>
                <p className="text-sm font-semibold text-ink">{row.ticker}</p>
                <p className="max-w-[220px] truncate text-xs text-ink-tertiary">{row.company}</p>
              </div>
              <div className="text-right">
                <p className={cn('text-sm font-semibold tabular-nums', row.changePercent >= 0 ? 'text-success' : 'text-danger')}>
                  {formatSignedPct(row.changePercent)}
                </p>
                <p className="text-xs text-ink-tertiary tabular-nums">{formatCompactCurrency(row.marketValue)}</p>
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function QuoteTable({ quotes, loading }: { quotes: MarketQuote[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }
  if (quotes.length === 0) {
    return <p className="py-4 text-sm text-ink-tertiary">No data available</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs font-medium text-ink-secondary">
          <th className="pb-2">Name</th>
          <th className="pb-2 text-right">Day</th>
          <th className="pb-2 text-right">YTD</th>
        </tr>
      </thead>
      <tbody>
        {quotes.map((q) => (
          <tr key={q.code} className="border-t border-border">
            <td className="py-2.5 font-medium text-ink">{q.label}</td>
            <ChangeCell value={q.dayChangePercent} />
            <ChangeCell value={q.ytdChangePercent} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangeCell({ value }: { value: number | null }) {
  if (value == null) {
    return <td className="py-2.5 text-right text-ink-tertiary">—</td>;
  }
  return (
    <td className={cn('py-2.5 text-right font-semibold tabular-nums', value >= 0 ? 'text-success' : 'text-danger')}>
      {formatSignedPct(value)}
    </td>
  );
}
