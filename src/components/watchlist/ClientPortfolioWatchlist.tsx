'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { watchlistApi } from '@/lib/watchlist.api';
import { clientsApi } from '@/lib/clients.api';
import { familiesApi } from '@/lib/families.api';
import { formatCurrency } from '@/lib/utils';
import { displayTicker } from '@/lib/market-scope';
import { downloadWatchlistWorkbook } from '@/lib/watchlistExport';
import {
  Client,
  Family,
  ClientPortfolioWatchlist as Watchlist,
  ClientWatchlistRow,
  ClientWatchlistWindow,
  PositionWindowReturn,
} from '@/types';
import { useMarket } from '@/components/layout/MarketContext';
import { Card, Button, Select, useToast } from '@/components/ui';
import { ContributionCell, ReturnCell, SortableHeader, type SortDir } from './WatchlistCells';

const WINDOWS: ClientWatchlistWindow[] = ['mtd', 'qtd', 'ytd'];
/** Contribution runs since inception rather than YTD: what the name has done for the book since it was bought. */
const CONTRIBUTION_WINDOWS: ClientWatchlistWindow[] = ['mtd', 'qtd', 'inception'];
const COLUMN_LABEL: Record<ClientWatchlistWindow, string> = {
  mtd: 'MTD',
  qtd: 'QTD',
  ytd: 'YTD',
  inception: 'Since inception',
};
const COLUMNS = 4 + WINDOWS.length + CONTRIBUTION_WINDOWS.length;

/** A return column sorts on its return, a `contrib:` column on the position's contribution. */
type SortKey = ClientWatchlistWindow | `contrib:${ClientWatchlistWindow}`;

/** Contribution below 0.005% reads as 0.00%; the "other" line is hidden while it stays there. */
const CONTRIBUTION_EPSILON = 0.005;

const CONTRIBUTION_TITLE =
  'What the position gained or lost over the period as a share of the portfolio: allocation at the start of ' +
  'the period × its return when nothing was bought or sold. A 10% position that rises 10% contributes +1.00%.';

const fmtDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const fmtQuantity = (qty: number) => qty.toLocaleString('en-IN', { maximumFractionDigits: 4 });

/**
 * The Watchlist, filled from a client's book instead of typed in.
 *
 * Every position the client holds today is listed with MTD / QTD / YTD for
 * THEIR holding: money-weighted, so a top-up is not read as gain, and on the
 * client's own calendar (April–March on the Indian book, clamped to the
 * 30-June-2026 inception). The book's indices are pinned underneath, measured
 * over exactly the same dates.
 *
 * A household can be picked in the same control. Its rows merge each symbol
 * across the members' accounts, and the server measures the merged holding as
 * one account, never as an average of the members' returns.
 */
export default function ClientPortfolioWatchlist() {
  const { toast } = useToast();
  const { market, ready: marketReady } = useMarket();

  const [clients, setClients] = useState<Client[]>([]);
  const [families, setFamilies] = useState<Family[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  // 'client:<id>' or 'family:<id>'. Both ids are opaque cuids, so the prefix is
  // what tells the loader which of the two lists a selection came from.
  const [subject, setSubject] = useState('');

  const [data, setData] = useState<Watchlist | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  // Only the latest request may land: switching clients mid-load must not let
  // the slower, earlier response paint the previous client's book.
  const requestSeq = useRef(0);

  // The selector lists the selected book's clients and households only, and a
  // switch of book clears the selection, since it belongs to the other book.
  useEffect(() => {
    if (!marketReady) return;
    setSubject('');
    setData(null);
    setClientsLoading(true);
    const byName = <T extends { name: string }>(list: T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name));
    Promise.all([
      clientsApi.list({ limit: 200, market }).catch(() => {
        toast({ tone: 'error', title: 'Could not load clients' });
        return [] as Client[];
      }),
      // A failed family list must not cost the desk its individual accounts.
      familiesApi.list(market).catch(() => [] as Family[]),
    ])
      .then(([clientList, familyList]) => {
        setClients(byName(clientList));
        setFamilies(byName(familyList));
      })
      .finally(() => setClientsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, marketReady]);

  const load = async (selection: string) => {
    const seq = ++requestSeq.current;
    const [kind, id] = selection.split(':');
    if (!id) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result =
        kind === 'family' ? await watchlistApi.familyPortfolio(id) : await watchlistApi.clientPortfolio(id);
      if (seq === requestSeq.current) setData(result);
    } catch {
      if (seq === requestSeq.current) {
        setData(null);
        toast({
          tone: 'error',
          title: kind === 'family' ? 'Could not load this household’s holdings' : 'Could not load this client’s holdings',
        });
      }
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  };

  useEffect(() => {
    load(subject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  const rows = data?.rows ?? [];
  const benchmarks = data?.benchmarks ?? [];
  // The book's headline index (Nifty 50 / S&P 500), first in the server's order.
  const primary = benchmarks[0];
  const isFamily = data?.kind === 'family';

  const toggleSort = (key: SortKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null; // third click clears back to the default, largest position first
    });
  };

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const valueOf = (row: ClientWatchlistRow) =>
      sort.key.startsWith('contrib:')
        ? row[sort.key.slice('contrib:'.length) as ClientWatchlistWindow].contributionPct
        : row[sort.key as ClientWatchlistWindow].returnPct;
    const withValue = rows.map((row) => ({ row, value: valueOf(row) }));
    withValue.sort((a, b) => {
      if (a.value == null && b.value == null) return 0;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return sort.dir === 'asc' ? a.value - b.value : b.value - a.value;
    });
    return withValue.map((w) => w.row);
  }, [rows, sort]);

  const isPartial = (w: ClientWatchlistWindow, r: PositionWindowReturn) =>
    !!data && r.measuredFrom > data.windows[w].from;

  const cellTitle = (w: ClientWatchlistWindow, r: PositionWindowReturn) => {
    if (r.returnPct == null) return r.reason ?? 'Not measurable over this window';
    if (isPartial(w, r)) return `Held from ${fmtDate(r.measuredFrom)}, so measured over a shorter span than the index`;
    return undefined;
  };

  const headerTitle = (w: ClientWatchlistWindow) => {
    if (!data) return undefined;
    const m = data.windows[w];
    const span = `${m.label}: ${fmtDate(m.from)} → ${fmtDate(m.to)}`;
    return m.nominalFrom ? `${span} (from ${fmtDate(m.from)} rather than ${fmtDate(m.nominalFrom)}: performance starts at inception)` : span;
  };

  const contributionHeaderTitle = (w: ClientWatchlistWindow) => {
    const span = headerTitle(w);
    return span ? `${CONTRIBUTION_TITLE}\n\n${span}` : CONTRIBUTION_TITLE;
  };

  const attributions = data ? CONTRIBUTION_WINDOWS.map((w) => data.windows[w].attribution) : [];
  const showOther = attributions.some((a) => a && Math.abs(a.otherPct) >= CONTRIBUTION_EPSILON);

  const anyPartial = rows.some((r) => WINDOWS.some((w) => isPartial(w, r[w])));
  const clampedWindows = data ? WINDOWS.filter((w) => data.windows[w].nominalFrom) : [];

  const handleExport = async () => {
    if (!data) return;
    try {
      // Rows go out in the order on screen, so an export keeps the chosen sort.
      await downloadWatchlistWorkbook(data, sortedRows);
    } catch {
      toast({ tone: 'error', title: 'Could not build the workbook' });
    }
  };

  return (
    <div className="space-y-6">
      <Card padding="md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            {/* Households first, then the individual accounts, in one control:
                the same grouping the Performance page uses. */}
            <Select
              label={families.length > 0 ? 'Client or household' : 'Client'}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={clientsLoading}
            >
              <option value="">
                {clientsLoading
                  ? 'Loading clients…'
                  : families.length > 0
                    ? 'Select a client or household…'
                    : clients.length > 0
                      ? 'Select a client…'
                      : 'No clients in this book'}
              </option>
              {families.length > 0 && (
                <optgroup label="Households">
                  {families.map((f) => (
                    <option key={f.id} value={`family:${f.id}`}>
                      {f.name} · {f.memberCount} {f.memberCount === 1 ? 'account' : 'accounts'}
                    </option>
                  ))}
                </optgroup>
              )}
              {clients.length > 0 && (
                <optgroup label={families.length > 0 ? 'Individual accounts' : 'Accounts'}>
                  {clients.map((c) => (
                    <option key={c.id} value={`client:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => load(subject)}
              disabled={!subject || loading}
            >
              Refresh
            </Button>
            <Button
              variant="outline"
              leftIcon={<Download className="h-3.5 w-3.5" />}
              onClick={handleExport}
              disabled={!data || rows.length === 0}
            >
              Export
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium text-ink-secondary">
                <th className="px-4 py-3">Symbol</th>
                <th className="px-4 py-3">Sector</th>
                <th className="px-4 py-3">Industry</th>
                <th className="px-4 py-3 text-right">Price</th>
                {WINDOWS.map((w) => (
                  <SortableHeader
                    key={w}
                    label={COLUMN_LABEL[w]}
                    sortKey={w}
                    active={sort}
                    onSort={toggleSort}
                    title={headerTitle(w)}
                  />
                ))}
                {CONTRIBUTION_WINDOWS.map((w, i) => (
                  <SortableHeader
                    key={`contrib:${w}`}
                    label={`${COLUMN_LABEL[w]} contrib.`}
                    sortKey={`contrib:${w}` as SortKey}
                    active={sort}
                    onSort={toggleSort}
                    title={contributionHeaderTitle(w)}
                    className={i === 0 ? 'border-l border-border' : undefined}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {!subject ? (
                <EmptyRow>
                  {families.length > 0
                    ? 'Select a client or household to see their holdings.'
                    : 'Select a client to see their holdings.'}
                </EmptyRow>
              ) : loading ? (
                <EmptyRow>Valuing the book…</EmptyRow>
              ) : !data ? (
                <EmptyRow>Holdings could not be loaded.</EmptyRow>
              ) : rows.length === 0 ? (
                <EmptyRow>{data.name} holds no positions.</EmptyRow>
              ) : (
                sortedRows.map((row) => (
                  <HoldingRow
                    key={row.symbol}
                    row={row}
                    currency={data.currency}
                    showHolders={isFamily}
                    primary={primary}
                    isPartial={isPartial}
                    cellTitle={cellTitle}
                  />
                ))
              )}
            </tbody>
            {data && !loading && (
              <tfoot>
                {rows.length > 0 && (
                  <>
                    {/* What the listed names don't explain, so the column foots to the Portfolio line. */}
                    {showOther && (
                      <tr className="border-t border-border">
                        <td
                          className="px-4 py-3 italic text-ink-secondary"
                          colSpan={4 + WINDOWS.length}
                          title="Positions sold out during the period, and fees or income booked without a symbol"
                        >
                          Sold during period &amp; fees
                        </td>
                        {attributions.map((a, i) => (
                          <ContributionCell key={i} value={a?.otherPct} divider={i === 0} />
                        ))}
                      </tr>
                    )}
                    <tr className="border-t-2 border-border-strong">
                      <td
                        className="px-4 py-3 font-bold text-ink"
                        colSpan={4 + WINDOWS.length}
                        title="The contributions above add up to this: a flow-adjusted (Modified Dietz) return on capital invested, which can differ slightly from the Performance page's money-weighted figure"
                      >
                        Portfolio
                      </td>
                      {attributions.map((a, i) => (
                        <ContributionCell
                          key={i}
                          value={a?.totalPct}
                          bold
                          divider={i === 0}
                          title={a ? undefined : 'The book could not be valued at the start of this period'}
                        />
                      ))}
                    </tr>
                  </>
                )}
                {benchmarks.map((b) => (
                  <tr key={b.code} className="border-t border-border bg-surface-2">
                    <td className="px-4 py-3 font-semibold text-ink-secondary" colSpan={4}>
                      {b.label}
                    </td>
                    {WINDOWS.map((w) => (
                      <ReturnCell key={w} value={b[w]} loading={false} plain />
                    ))}
                    {/* An index contributes nothing to the book. */}
                    <td className="border-l border-border" colSpan={CONTRIBUTION_WINDOWS.length} />
                  </tr>
                ))}
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {data && !loading && rows.length > 0 && (
        <div className="space-y-1 text-xs text-ink-tertiary">
          {isFamily ? (
            <p>
              Each symbol combines every account in the household that holds it (
              {data.members.map((m) => m.name).join(', ')}), and its return is money-weighted for the household as one
              account, so purchases and sales inside a window, in any member&rsquo;s account, are not counted as gain or
              loss. As of {fmtDate(data.asOf)}.
            </p>
          ) : (
            <p>
              Returns are money-weighted for this client&rsquo;s own holding, so purchases and sales inside a window are
              not counted as gain or loss. As of {fmtDate(data.asOf)}.
            </p>
          )}
          {anyPartial && <p>† Position opened inside the window. Measured from its first purchase, so not compared to the index.</p>}
          <p>
            Contribution is what a position gained or lost over the period as a share of the portfolio: its allocation at
            the start of the period × its return, when nothing was bought or sold. Capital added during the period widens
            the base rather than counting as return, and the column adds up to the Portfolio line.
          </p>
          {clampedWindows.map((w) => (
            <p key={w}>
              {COLUMN_LABEL[w]} ({data.windows[w].label}) is measured from {fmtDate(data.windows[w].from)}, the start of
              reported performance, rather than {fmtDate(data.windows[w].nominalFrom!)}.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyRow({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={COLUMNS} className="px-4 py-8 text-center text-ink-tertiary">
        {children}
      </td>
    </tr>
  );
}

function HoldingRow({
  row,
  currency,
  showHolders,
  primary,
  isPartial,
  cellTitle,
}: {
  row: ClientWatchlistRow;
  currency: string;
  /** On a household: which member accounts the row was merged from. */
  showHolders: boolean;
  primary?: Record<ClientWatchlistWindow, number | null>;
  isPartial: (w: ClientWatchlistWindow, r: PositionWindowReturn) => boolean;
  cellTitle: (w: ClientWatchlistWindow, r: PositionWindowReturn) => string | undefined;
}) {
  const priceMissing = row.priceStatus === 'missing';
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3">
        <p className="font-semibold text-ink">{displayTicker(row.symbol)}</p>
        {row.company && <p className="max-w-[200px] truncate text-xs text-ink-tertiary">{row.company}</p>}
        {showHolders && row.holders.length > 0 && (
          <p
            className="max-w-[200px] truncate text-xs text-ink-secondary"
            title={row.holders.map((h) => `${h.clientName}: ${fmtQuantity(h.quantity)}`).join('\n')}
          >
            {row.holders.length === 1 ? row.holders[0].clientName : `${row.holders.length} accounts`}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-ink-secondary">{row.sector || '—'}</td>
      <td className="px-4 py-3 text-ink-secondary">{row.industry || '—'}</td>
      <td
        className="px-4 py-3 text-right tabular-nums text-ink"
        title={
          priceMissing
            ? 'No close found for this symbol; average cost is shown in its place'
            : row.priceDate
              ? `Close of ${fmtDate(row.priceDate)}`
              : undefined
        }
      >
        {formatCurrency(row.price, currency)}
        {priceMissing && <span className="ml-0.5 text-ink-tertiary">*</span>}
      </td>
      {WINDOWS.map((w) => (
        <ReturnCell
          key={w}
          value={row[w].returnPct}
          loading={false}
          benchmark={primary?.[w]}
          partial={isPartial(w, row[w])}
          title={cellTitle(w, row[w])}
        />
      ))}
      {CONTRIBUTION_WINDOWS.map((w, i) => (
        <ContributionCell
          key={w}
          value={row[w].contributionPct}
          divider={i === 0}
          title={row[w].contributionPct == null ? cellTitle(w, row[w]) : undefined}
        />
      ))}
    </tr>
  );
}
