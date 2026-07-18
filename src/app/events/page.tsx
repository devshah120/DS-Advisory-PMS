'use client';

import { useEffect, useMemo, useState } from 'react';
import { TrendingUp, Coins, Split } from 'lucide-react';
import { eventsApi } from '@/lib/events.api';
import { formatDate, cn } from '@/lib/utils';
import { PortfolioEvent, PortfolioEventType } from '@/types';
import AppShell from '@/components/layout/AppShell';
import { Badge, DataTable, useToast, type Column } from '@/components/ui';
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
  const { toast } = useToast();
  const [events, setEvents] = useState<PortfolioEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<PortfolioEventType | 'ALL'>('ALL');

  useEffect(() => {
    let mounted = true;
    eventsApi
      .forHoldings()
      .then((data) => mounted && setEvents(data))
      .catch(() => mounted && toast({ tone: 'error', title: 'Failed to load the event calendar' }))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => (typeFilter === 'ALL' ? events : events.filter((e) => e.type === typeFilter)),
    [events, typeFilter],
  );

  const columns: Column<PortfolioEvent>[] = [
    {
      key: 'ticker',
      header: 'Symbol',
      accessor: (e) => e.ticker,
      render: (e) => (
        <div>
          <p className="font-semibold text-ink">{e.ticker}</p>
          <p className="max-w-[220px] truncate text-xs text-ink-tertiary">{e.company}</p>
        </div>
      ),
      width: '220px',
    },
    {
      key: 'event',
      header: 'Event',
      accessor: (e) => TYPE_META[e.type].label,
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
            <span className="text-[13px] font-medium text-ink">{meta.label}</span>
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
      render: (e) => (
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
    <AppShell
      title="Event Center"
      subtitle="Upcoming earnings, dividends, and corporate actions across every holding"
    >
      <div className="space-y-4">
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

        <DataTable
          columns={columns}
          data={filtered}
          loading={loading}
          rowKey={(e) => `${e.ticker}-${e.type}-${e.date}`}
          searchPlaceholder="Search by symbol or company…"
          searchKeys={(e) => `${e.ticker} ${e.company}`}
          pageSize={10}
          onExport={(rows) =>
            exportToCsv(
              'event-center.csv',
              [
                { key: 'ticker', header: 'Symbol', accessor: (e: PortfolioEvent) => e.ticker },
                { key: 'company', header: 'Company', accessor: (e: PortfolioEvent) => e.company },
                { key: 'event', header: 'Event', accessor: (e: PortfolioEvent) => TYPE_META[e.type].label },
                { key: 'date', header: 'Date', accessor: (e: PortfolioEvent) => e.date },
                { key: 'clientCount', header: 'Held By (clients)', accessor: (e: PortfolioEvent) => e.clientCount },
                { key: 'status', header: 'Status', accessor: (e: PortfolioEvent) => e.status },
              ],
              rows,
            )
          }
          emptyTitle="No upcoming events"
          emptyDescription="Nothing in the next ~60 days for tickers currently held across your clients."
        />
      </div>
    </AppShell>
  );
}
