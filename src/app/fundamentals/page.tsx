'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fundamentalsApi } from '@/lib/fundamentals.api';
import { formatCompactCurrency, formatSignedPct, formatDate, cn } from '@/lib/utils';
import { FundamentalView } from '@/types';
import AppShell from '@/components/layout/AppShell';
import { Button, DataTable, useToast, type Column } from '@/components/ui';
import { ScoreHoverCard } from './ScoreHoverCard';

function pillarCell(score: number) {
  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        score >= 75 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-danger',
      )}
    >
      {score.toFixed(0)}
    </span>
  );
}

function pctCell(value: number | null, decimals = 1) {
  if (value == null) return <span className="text-ink-tertiary">—</span>;
  return <span className={cn('tabular-nums', value >= 0 ? 'text-success' : 'text-danger')}>{formatSignedPct(value, decimals)}</span>;
}

export default function FundamentalsPage() {
  const { toast } = useToast();
  const [strategy, setStrategy] = useState('GARP');
  const [strategies, setStrategies] = useState<string[]>(['GARP']);
  const [rows, setRows] = useState<FundamentalView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fundamentalsApi
      .strategies()
      .then((s) => s.length > 0 && setStrategies(s))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fundamentalsApi
      .list(strategy)
      .then((data) => mounted && setRows(data))
      .catch(() => mounted && toast({ tone: 'error', title: 'Failed to load fundamentals' }))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const result = await fundamentalsApi.refresh();
      toast({
        tone: result.failed.length === 0 ? 'success' : 'info',
        title: `Refreshed ${result.refreshed} symbol${result.refreshed === 1 ? '' : 's'}`,
        description: result.failed.length ? `${result.failed.length} failed: ${result.failed.join(', ')}` : undefined,
      });
      const data = await fundamentalsApi.list(strategy);
      setRows(data);
    } catch {
      toast({ tone: 'error', title: 'Refresh failed' });
    } finally {
      setRefreshing(false);
    }
  };

  const columns: Column<FundamentalView>[] = useMemo(
    () => [
      {
        key: 'symbol',
        header: 'Symbol',
        accessor: (r) => r.symbol,
        render: (r) => (
          <div>
            <p className="font-semibold text-ink">{r.symbol}</p>
            <p className="max-w-[180px] truncate text-xs text-ink-tertiary">{r.company}</p>
          </div>
        ),
        width: '180px',
      },
      { key: 'sector', header: 'Sector', accessor: (r) => r.sector, render: (r) => <span className="text-ink-secondary">{r.sector}</span> },
      {
        key: 'industry',
        header: 'Industry',
        accessor: (r) => r.industry,
        render: (r) => <span className="text-ink-secondary">{r.industry}</span>,
      },
      {
        key: 'overallScore',
        header: 'AFS Score',
        accessor: (r) => r.overallScore,
        align: 'center',
        render: (r) => <ScoreHoverCard view={r} />,
      },
      { key: 'growthScore', header: 'Growth', accessor: (r) => r.growthScore, align: 'right', render: (r) => pillarCell(r.growthScore) },
      {
        key: 'profitabilityScore',
        header: 'Profitability',
        accessor: (r) => r.profitabilityScore,
        align: 'right',
        render: (r) => pillarCell(r.profitabilityScore),
      },
      {
        key: 'financialStrengthScore',
        header: 'Fin. Strength',
        accessor: (r) => r.financialStrengthScore,
        align: 'right',
        render: (r) => pillarCell(r.financialStrengthScore),
      },
      {
        key: 'valuationScore',
        header: 'Valuation',
        accessor: (r) => r.valuationScore,
        align: 'right',
        render: (r) => pillarCell(r.valuationScore),
      },
      {
        key: 'momentumScore',
        header: 'Momentum',
        accessor: (r) => r.momentumScore,
        align: 'right',
        render: (r) => pillarCell(r.momentumScore),
      },
      {
        key: 'pe',
        header: 'PE',
        accessor: (r) => r.snapshot.peRatio ?? 0,
        align: 'right',
        defaultHidden: true,
        render: (r) => <span className="tabular-nums text-ink">{r.snapshot.peRatio?.toFixed(1) ?? '—'}</span>,
      },
      {
        key: 'industryPe',
        header: 'Industry PE',
        accessor: (r) => r.industryComparison?.metrics.find((m) => m.metric === 'PE')?.industryAverage ?? 0,
        align: 'right',
        defaultHidden: true,
        render: (r) => {
          const v = r.industryComparison?.metrics.find((m) => m.metric === 'PE')?.industryAverage;
          return <span className="tabular-nums text-ink-secondary">{v != null ? v.toFixed(1) : '—'}</span>;
        },
      },
      {
        key: 'revenueYoy',
        header: 'Revenue YoY',
        accessor: (r) => r.snapshot.revenueYoyPercent ?? 0,
        align: 'right',
        render: (r) => pctCell(r.snapshot.revenueYoyPercent),
      },
      {
        key: 'profitYoy',
        header: 'Profit YoY',
        accessor: (r) => r.snapshot.netProfitYoyPercent ?? 0,
        align: 'right',
        render: (r) => pctCell(r.snapshot.netProfitYoyPercent),
      },
      {
        key: 'revenueCagr',
        header: 'Revenue CAGR',
        accessor: (r) => r.snapshot.revenueCagr3y ?? 0,
        align: 'right',
        defaultHidden: true,
        render: (r) => pctCell(r.snapshot.revenueCagr3y),
      },
      {
        key: 'profitCagr',
        header: 'Profit CAGR',
        accessor: (r) => r.snapshot.netProfitCagr3y ?? 0,
        align: 'right',
        defaultHidden: true,
        render: (r) => pctCell(r.snapshot.netProfitCagr3y),
      },
      {
        key: 'roe',
        header: 'ROE',
        accessor: (r) => r.snapshot.roe ?? 0,
        align: 'right',
        render: (r) => pctCell(r.snapshot.roe),
      },
      {
        key: 'debtToEquity',
        header: 'Debt/Equity',
        accessor: (r) => r.snapshot.debtToEquity ?? 0,
        align: 'right',
        render: (r) => (
          <span className="tabular-nums text-ink">{r.snapshot.debtToEquity != null ? `${r.snapshot.debtToEquity.toFixed(2)}x` : '—'}</span>
        ),
      },
      {
        key: 'nextEarnings',
        header: 'Next Earnings',
        accessor: (r) => r.snapshot.nextEarningsDate ?? '',
        render: (r) => (
          <span className="text-ink-secondary">{r.snapshot.nextEarningsDate ? formatDate(r.snapshot.nextEarningsDate) : '—'}</span>
        ),
      },
      {
        key: 'dividendYield',
        header: 'Dividend Yield',
        accessor: (r) => r.snapshot.dividendYield ?? 0,
        align: 'right',
        defaultHidden: true,
        render: (r) => (
          <span className="tabular-nums text-ink">{r.snapshot.dividendYield != null ? `${r.snapshot.dividendYield.toFixed(2)}%` : '—'}</span>
        ),
      },
    ],
    [],
  );

  return (
    <AppShell
      title="Fundamentals"
      subtitle="Atlas Fundamental Score — Growth At Reasonable Price, scored against a configurable rules engine"
      actions={
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-[10px] border border-border bg-surface-2 p-1">
            {strategies.map((s) => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={cn(
                  'rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition-colors',
                  strategy === s ? 'bg-white text-ink shadow-sm' : 'text-ink-secondary hover:text-ink',
                )}
              >
                {s}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />}
            onClick={handleRefresh}
            loading={refreshing}
          >
            Refresh
          </Button>
        </div>
      }
    >
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        rowKey={(r) => `${r.symbol}-${r.strategy}`}
        searchPlaceholder="Search by symbol, company, sector…"
        searchKeys={(r) => `${r.symbol} ${r.company} ${r.sector} ${r.industry}`}
        pageSize={15}
        emptyTitle="No fundamentals data yet"
        emptyDescription="Add tickers to a client's holdings or a watchlist, then click Refresh to pull fundamentals for them."
      />
    </AppShell>
  );
}
