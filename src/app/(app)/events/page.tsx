'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { TrendingUp, Coins, Split, RefreshCw } from 'lucide-react';
import { eventsApi } from '@/lib/events.api';
import { formatDate, cn } from '@/lib/utils';
import { displayTicker } from '@/lib/market-scope';
import { useMarket } from '@/components/layout/MarketContext';
import { PortfolioEvent, PortfolioEventType } from '@/types';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import { Badge, Button, DataTable, useToast, type Column } from '@/components/ui';
import { exportToCsv } from '@/components/ui';

const TYPE_META: Record<
  PortfolioEventType,
  { label: string; icon: typeof TrendingUp; tone: 'brand' | 'success' | 'info' }
> = {
  EARNINGS: { label: 'Earnings', icon: TrendingUp, tone: 'brand' },
  DIVIDEND: { label: 'Dividend Ex-Date', icon: Coins, tone: 'success' },
  SPLIT: { label: 'Stock Split', icon: Split, tone: 'info' },
};

const TYPE_FILTERS: Array<{ value: PortfolioEventType | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All events' },
  { value: 'EARNINGS', label: 'Earnings' },
  { value: 'DIVIDEND', label: 'Dividends' },
  { value: 'SPLIT', label: 'Corporate actions' },
];

export default function EventCenterPage() {
  const { market, meta, ready: marketReady } = useMarket();

  usePageHeading({
    title: 'Event Center',
    subtitle: `Upcoming earnings, dividends, and corporate actions across the ${meta.label} book`,
  });

  const { toast } = useToast();
  const [events, setEvents] = useState<PortfolioEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<PortfolioEventType | 'ALL'>('ALL');

  const load = useCallback(async () => {
    try {
      setEvents(await eventsApi.forHoldings(market));
    } catch {
      toast({ tone: 'error', title: 'Failed to load the event calendar' });
    } finally {
      setLoading(false);
    }
  }, [toast, market]);

  // Re-loads on a book switch, and shows the spinner while it does so the table
  // never displays the previous market's events under the new selector.
  useEffect(() => {
    if (!marketReady) return;
    setLoading(true);
    void load();
  }, [load, marketReady]);

  // One Yahoo request per held ticker, so this takes a few seconds: re-fetches
  // the calendar into the DB snapshot, then reloads the page from that snapshot.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const { refreshed } = await eventsApi.refresh();
      await load();
      toast({ tone: 'success', title: `Event calendar refreshed — ${refreshed} events` });
    } catch {
      toast({ tone: 'error', title: 'Refresh failed — Yahoo may be rate-limiting' });
    } finally {
      setRefreshing(false);
    }
  }, [load, toast]);

  const filtered = useMemo(
    () => (typeFilter === 'ALL' ? events : events.filter((e) => e.type === typeFilter)),
    [events, typeFilter],
  );

  const columns: Column<PortfolioEvent>[] = [
    {
      key: 'ticker',
      header: 'Symbol',
      accessor: (e) => e.ticker,
      // 'RELIANCE.NS' reads as 'RELIANCE' — the exchange suffix is plumbing the
      // desk does not need to see, and the Indian book is entirely suffixed.
      render: (e) => (
        <div>
          <p className="font-semibold text-ink">{displayTicker(e.ticker)}</p>
          <p className="max-w-[220px] truncate text-xs text-ink-tertiary">{e.company}</p>
        </div>
      ),
      width: '220px',
    },
    {
      key: 'event',
      header: 'Event',
      // The backend's label is more specific than the type (a DIVIDEND row is
      // either an ex-date or a pay date), so prefer it and keep the type only
      // as the icon/tone lookup and the fallback.
      accessor: (e) => e.label || TYPE_META[e.type].label,
      render: (e) => {
        const meta = TYPE_META[e.type];
        const Icon = meta.icon;
        return (
          <span className="inline-flex items-center gap-2">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-[7px]',
                meta.tone === 'brand' && 'bg-brand-soft text-brand',
                meta.tone === 'success' && 'bg-success-soft text-success',
                meta.tone === 'info' && 'bg-info-soft text-[#0369a1]',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="text-[13px] font-medium text-ink">{e.label || meta.label}</span>
          </span>
        );
      },
    },
    {
      key: 'date',
      header: 'Date',
      accessor: (e) => e.date,
      render: (e) => <span className="tabular-nums text-ink-secondary">{formatDate(e.date)}</span>,
    },
    {
      key: 'clientCount',
      header: 'Held By',
      accessor: (e) => e.clientCount,
      align: 'right',
      // A watchlisted candidate has no holders yet; "0 clients" would read as a
      // data error, so it is labelled for what it is.
      render: (e) =>
        e.watchlistOnly ? (
          <Badge tone="neutral">Watchlist</Badge>
        ) : (
          <span className="tabular-nums text-ink-secondary">
            {e.clientCount} client{e.clientCount === 1 ? '' : 's'}
          </span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (e) => e.status,
      sortable: false,
      render: (e) => (
        <Badge tone={e.status === 'Confirmed' ? 'success' : 'warning'} dot>
          {e.status}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                  typeFilter === f.value
                    ? 'border-brand bg-brand-soft text-brand'
                    : 'border-border text-ink-secondary hover:bg-surface-2',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            loading={refreshing}
            onClick={handleRefresh}
            leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
          >
            {refreshing ? 'Refreshing…' : 'Refresh from Yahoo'}
          </Button>
        </div>

        <DataTable
          columns={columns}
          data={filtered}
          loading={loading}
          rowKey={(e) => `${e.ticker}-${e.type}-${e.label}-${e.date}`}
          searchPlaceholder="Search by symbol or company…"
          searchKeys={(e) => `${e.ticker} ${e.company}`}
          pageSize={10}
          onExport={(rows) =>
            exportToCsv(
              `event-center-${market.toLowerCase()}.csv`,
              [
                { key: 'ticker', header: 'Symbol', accessor: (e: PortfolioEvent) => displayTicker(e.ticker) },
                { key: 'company', header: 'Company', accessor: (e: PortfolioEvent) => e.company },
                { key: 'event', header: 'Event', accessor: (e: PortfolioEvent) => e.label || TYPE_META[e.type].label },
                { key: 'date', header: 'Date', accessor: (e: PortfolioEvent) => e.date },
                {
                  key: 'clientCount',
                  header: 'Held By (clients)',
                  accessor: (e: PortfolioEvent) => (e.watchlistOnly ? 'Watchlist' : e.clientCount),
                },
                { key: 'status', header: 'Status', accessor: (e: PortfolioEvent) => e.status },
              ],
              rows,
            )
          }
          emptyTitle="No upcoming events"
          emptyDescription={`Nothing in the next ~60 days for ${meta.label} names held or watchlisted across your clients.`}
        />
      </div>
    </>
  );
}
