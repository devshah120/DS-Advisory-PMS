'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TrendingUp, Coins, Split, RefreshCw } from 'lucide-react';
import { eventsApi } from '@/lib/events.api';
import { formatCurrency, formatDate, formatNumber, cn } from '@/lib/utils';
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

/** Reads the inferred payout count back as the word an advisor would use. */
const FREQUENCY_LABEL: Record<number, string> = {
  1: 'annual',
  2: 'semi-annual',
  4: 'quarterly',
  12: 'monthly',
};

/**
 * The per-client breakdown behind the Held By count.
 *
 * Rendered through a portal onto document.body rather than inside the cell:
 * DataTable wraps its table in `overflow-hidden` and `overflow-x-auto`, either
 * of which would clip a panel positioned within the row. Fixing that in the
 * shared component would change every other table's chrome, so the escape
 * happens here instead.
 *
 * Position is measured from the trigger and flipped up when the panel would
 * cross the viewport bottom, which is what makes it correct on the last rows of
 * a page regardless of where the table sits on screen.
 */
function HolderPanel({ event, currency, anchor }: {
  event: PortfolioEvent;
  currency: string;
  anchor: DOMRect;
}) {
  const WIDTH = 340;
  const MARGIN = 8;

  // Estimated height drives only the flip decision; being a little off shifts
  // the panel, it does not break it.
  const estimatedHeight = 120 + event.holders.length * 24;
  const flipUp = anchor.bottom + estimatedHeight + MARGIN > window.innerHeight;

  const top = flipUp ? anchor.top - MARGIN : anchor.bottom + MARGIN;
  // Right-aligned to the trigger, clamped so a narrow viewport never pushes the
  // panel off the left edge.
  const left = Math.max(MARGIN, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - MARGIN));

  return createPortal(
    <div
      className="pointer-events-none fixed z-50"
      style={{
        top,
        left,
        width: WIDTH,
        transform: flipUp ? 'translateY(-100%)' : undefined,
      }}
      role="tooltip"
    >
      <HolderBreakdown event={event} currency={currency} />
    </div>,
    document.body,
  );
}

function HolderBreakdown({ event, currency }: {
  event: PortfolioEvent;
  currency: string;
}) {
  const isDividend = event.type === 'DIVIDEND';
  const hasAmounts = isDividend && event.totalAnnualAmount != null;
  const hasEstimate = isDividend && event.totalEstimatedAmount != null;

  return (
    <div className="w-full rounded-xl border border-border bg-surface p-3 text-left shadow-lg">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-ink">
          {displayTicker(event.ticker)} — {event.label}
        </p>
        {isDividend && event.dividendRate != null && (
          <p className="shrink-0 text-xs text-ink-tertiary">
            {formatCurrency(event.dividendRate, currency)}/sh
            {event.payoutsPerYear ? ` · ${FREQUENCY_LABEL[event.payoutsPerYear] ?? 'annual'}` : ''}
          </p>
        )}
      </div>

      {/* A split moves share counts, not cash — saying so beats an empty amount column. */}
      {event.type === 'SPLIT' && (
        <p className="mb-2 text-xs text-ink-tertiary">
          A split changes share counts, not cash. Quantities shown are pre-split.
        </p>
      )}
      {isDividend && !hasAmounts && (
        <p className="mb-2 text-xs text-ink-tertiary">
          No dividend rate published for this name — quantities only.
        </p>
      )}

      <table className="w-full text-xs">
        <thead>
          <tr className="text-ink-tertiary">
            <th className="pb-1 text-left font-medium">Client</th>
            <th className="pb-1 text-right font-medium">Shares</th>
            {hasEstimate && <th className="pb-1 text-right font-medium">This pay</th>}
            {hasAmounts && <th className="pb-1 text-right font-medium">Annual</th>}
          </tr>
        </thead>
        <tbody>
          {event.holders.map((h) => (
            <tr key={h.clientId} className="border-t border-border/60">
              <td className="max-w-[130px] truncate py-1 pr-2 text-ink-secondary">{h.clientName}</td>
              <td className="py-1 text-right tabular-nums text-ink-secondary">
                {formatNumber(h.quantity, 0)}
              </td>
              {hasEstimate && (
                <td className="py-1 pl-2 text-right tabular-nums text-ink">
                  {h.estimatedAmount != null ? formatCurrency(h.estimatedAmount, currency) : '—'}
                </td>
              )}
              {hasAmounts && (
                <td className="py-1 pl-2 text-right tabular-nums text-ink-secondary">
                  {h.annualAmount != null ? formatCurrency(h.annualAmount, currency) : '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold text-ink">
            <td className="pt-1.5">
              {event.clientCount} client{event.clientCount === 1 ? '' : 's'}
            </td>
            <td className="pt-1.5 text-right tabular-nums">
              {formatNumber(event.totalQuantity, 0)}
            </td>
            {hasEstimate && (
              <td className="pt-1.5 pl-2 text-right tabular-nums">
                {formatCurrency(event.totalEstimatedAmount!, currency)}
              </td>
            )}
            {hasAmounts && (
              <td className="pt-1.5 pl-2 text-right tabular-nums">
                {formatCurrency(event.totalAnnualAmount!, currency)}
              </td>
            )}
          </tr>
        </tfoot>
      </table>

      {hasEstimate && (
        <p className="mt-2 border-t border-border pt-1.5 text-[11px] leading-snug text-ink-tertiary">
          &ldquo;This pay&rdquo; is the annual rate divided by the{' '}
          {FREQUENCY_LABEL[event.payoutsPerYear!] ?? 'annual'} payout frequency — an estimate, not a
          declared amount.
        </p>
      )}
    </div>
  );
}

/**
 * The Held By count, with the per-client breakdown on hover or keyboard focus.
 *
 * The anchor rect is measured on open rather than on render: the table scrolls
 * and paginates underneath, and a stale rect would strand the panel away from
 * its trigger. Focus opens it too, so the breakdown is reachable without a
 * mouse.
 */
function HeldByCell({ event, currency }: { event: PortfolioEvent; currency: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const open = useCallback(() => {
    if (ref.current) setAnchor(ref.current.getBoundingClientRect());
  }, []);
  const close = useCallback(() => setAnchor(null), []);

  // A scroll or resize while the panel is open would leave it floating beside
  // nothing, so it closes rather than trying to track the trigger.
  useEffect(() => {
    if (!anchor) return;
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor, close]);

  return (
    <span
      ref={ref}
      className="relative inline-block cursor-help tabular-nums text-ink-secondary underline decoration-dotted underline-offset-4"
      tabIndex={0}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {event.clientCount} client{event.clientCount === 1 ? '' : 's'}
      {anchor && <HolderPanel event={event} currency={currency} anchor={anchor} />}
    </span>
  );
}

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

  // Every event in the calendar belongs to the selected book, so the book's
  // currency is the right one for every amount on the page — no per-row lookup.
  const currency = meta.currency;

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
      key: 'dividend',
      header: 'Dividend / Action',
      // Sorts on the whole book's annual entitlement rather than the per-share
      // rate: "which event pays my clients the most" is the question the desk
      // actually sorts this column to answer.
      accessor: (e) => e.totalAnnualAmount ?? 0,
      align: 'right',
      render: (e) => {
        if (e.type !== 'DIVIDEND') {
          // Splits carry a ratio in the label already; earnings carry no amount.
          return <span className="text-ink-tertiary">—</span>;
        }
        if (e.dividendRate == null) {
          return <span className="text-ink-tertiary">Rate n/a</span>;
        }
        return (
          <div className="leading-tight">
            <p className="tabular-nums font-medium text-ink">
              {formatCurrency(e.dividendRate, currency)}
              <span className="text-ink-tertiary">/sh</span>
            </p>
            <p className="text-xs text-ink-tertiary">
              {e.payoutsPerYear
                ? `${FREQUENCY_LABEL[e.payoutsPerYear] ?? 'annual'} · annual rate`
                : 'annual rate'}
            </p>
          </div>
        );
      },
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
          <HeldByCell event={e} currency={currency} />
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
            {refreshing ? 'Refreshing…' : 'Refresh'}
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
                  key: 'dividendRate',
                  header: `Dividend / Share (annual, ${currency})`,
                  accessor: (e: PortfolioEvent) => e.dividendRate ?? '',
                },
                {
                  key: 'totalEstimated',
                  header: `Est. This Payment (all clients, ${currency})`,
                  accessor: (e: PortfolioEvent) => e.totalEstimatedAmount ?? '',
                },
                {
                  key: 'totalAnnual',
                  header: `Annual Dividend (all clients, ${currency})`,
                  accessor: (e: PortfolioEvent) => e.totalAnnualAmount ?? '',
                },
                {
                  key: 'clientCount',
                  header: 'Held By (clients)',
                  accessor: (e: PortfolioEvent) => (e.watchlistOnly ? 'Watchlist' : e.clientCount),
                },
                {
                  key: 'holders',
                  // Flattened into one cell: the CSV is a flat grid, and an
                  // advisor exporting this wants the per-client detail that the
                  // hover shows rather than just the count.
                  header: 'Per-Client Breakdown',
                  accessor: (e: PortfolioEvent) =>
                    e.holders
                      .map((h) => {
                        const amount = h.estimatedAmount ?? h.annualAmount;
                        return amount != null
                          ? `${h.clientName}: ${formatNumber(h.quantity, 0)} sh / ${formatCurrency(amount, currency)}`
                          : `${h.clientName}: ${formatNumber(h.quantity, 0)} sh`;
                      })
                      .join('; '),
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
