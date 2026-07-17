'use client';

import { useEffect, useMemo, useState } from 'react';
import { Briefcase, TrendingUp, Layers, Wallet, Trash2, Tag, ChevronRight } from 'lucide-react';
import { apiClient } from '@/lib/api';
import {
  formatCurrency,
  formatCompactCurrency,
  formatSignedCurrency,
  formatPct,
  formatSignedPct,
  cn,
} from '@/lib/utils';
import { Holding, Client } from '@/types';
import AppShell from '@/components/layout/AppShell';
import {
  Card,
  Tabs,
  Badge,
  Button,
  Drawer,
  DataTable,
  exportToCsv,
  useToast,
  type Column,
} from '@/components/ui';

interface HoldingRow extends Holding {
  client?: Client;
}

interface SymbolRow {
  symbol: string;
  company: string;
  sector: string;
  totalQuantity: number;
  currentPrice: number;
  totalMarketValue: number;
  totalPnL: number;
  changePercent: number;
  accounts: number;
}

interface ClientRow {
  clientId: string;
  clientName: string;
  holdings: number;
  marketValue: number;
  pnl: number;
  portfolioValue: number;
}

interface SectorRow {
  sector: string;
  positions: number;
  marketValue: number;
  pnl: number;
  weight: number;
}

/** One position inside a client's drill-down, mirroring the portfolio sheet layout. */
interface ClientPositionRow {
  id: string;
  srNo: number;
  symbol: string;
  name: string;
  quantity: number;
  averageCostBasis: number;
  costBasisTotal: number;
  lastPrice: number;
  currentValue: number;
  pl: number;
  plPercent: number;
  allocPercent: number;
}

export default function HoldingsPage() {
  const { toast } = useToast();
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'symbols' | 'clients' | 'sectors' | 'all'>('symbols');
  const [activeClient, setActiveClient] = useState<ClientRow | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.getClient().get('/holdings');
        setHoldings(res.data);
      } catch {
        toast({ tone: 'error', title: 'Failed to load holdings' });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const symbolRows: SymbolRow[] = useMemo(() => {
    const map = new Map<string, SymbolRow>();
    holdings.forEach((h) => {
      const cur =
        map.get(h.ticker) ??
        {
          symbol: h.ticker,
          company: h.company,
          sector: h.sector,
          totalQuantity: 0,
          currentPrice: h.currentPrice,
          totalMarketValue: 0,
          totalPnL: 0,
          changePercent: ((h.currentPrice - h.averageCost) / h.averageCost) * 100,
          accounts: 0,
        };
      cur.totalQuantity += h.quantity;
      cur.totalMarketValue += h.marketValue;
      cur.totalPnL += h.unrealizedPnL;
      cur.accounts += 1;
      map.set(h.ticker, cur);
    });
    return [...map.values()].sort((a, b) => b.totalMarketValue - a.totalMarketValue);
  }, [holdings]);

  const clientRows: ClientRow[] = useMemo(() => {
    const map = new Map<string, ClientRow>();
    holdings.forEach((h) => {
      const cur =
        map.get(h.clientId) ??
        {
          clientId: h.clientId,
          clientName: h.client?.name ?? 'Unknown',
          holdings: 0,
          marketValue: 0,
          pnl: 0,
          portfolioValue: h.client?.portfolioValue ?? 0,
        };
      cur.holdings += 1;
      cur.marketValue += h.marketValue;
      cur.pnl += h.unrealizedPnL;
      map.set(h.clientId, cur);
    });
    return [...map.values()].sort((a, b) => b.marketValue - a.marketValue);
  }, [holdings]);

  const totalMv = holdings.reduce((s, h) => s + h.marketValue, 0);
  const totalPnl = holdings.reduce((s, h) => s + h.unrealizedPnL, 0);

  const sectorRows: SectorRow[] = useMemo(() => {
    const total = holdings.reduce((s, h) => s + h.marketValue, 0);
    const map = new Map<string, SectorRow>();
    holdings.forEach((h) => {
      const sector = h.sector || 'Uncategorized';
      const cur =
        map.get(sector) ??
        {
          sector,
          positions: 0,
          marketValue: 0,
          pnl: 0,
          weight: 0,
        };
      cur.positions += 1;
      cur.marketValue += h.marketValue;
      cur.pnl += h.unrealizedPnL;
      map.set(sector, cur);
    });
    return [...map.values()]
      .map((r) => ({ ...r, weight: total ? (r.marketValue / total) * 100 : 0 }))
      .sort((a, b) => b.marketValue - a.marketValue);
  }, [holdings]);

  /** Positions belonging to the client opened in the drill-down drawer. */
  const clientPositions: ClientPositionRow[] = useMemo(() => {
    if (!activeClient) return [];
    const owned = holdings.filter((h) => h.clientId === activeClient.clientId);
    const total = owned.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
    return owned
      .slice()
      .sort((a, b) => b.quantity * b.currentPrice - a.quantity * a.currentPrice)
      .map((h, i) => {
        // Derived from the position itself rather than read off the stored
        // columns, so a row written before P&L was computed still reads true.
        const costBasisTotal = h.averageCost * h.quantity;
        const currentValue = h.quantity * h.currentPrice;
        const pl = currentValue - costBasisTotal;
        return {
          id: h.id,
          srNo: i + 1,
          symbol: h.ticker,
          name: h.company,
          quantity: h.quantity,
          averageCostBasis: h.averageCost,
          costBasisTotal,
          lastPrice: h.currentPrice,
          currentValue,
          pl,
          plPercent: costBasisTotal ? (pl / costBasisTotal) * 100 : 0,
          allocPercent: total ? (currentValue / total) * 100 : 0,
        };
      });
  }, [holdings, activeClient]);

  const clientTotals = useMemo(
    () =>
      clientPositions.reduce(
        (acc, r) => ({
          costBasisTotal: acc.costBasisTotal + r.costBasisTotal,
          currentValue: acc.currentValue + r.currentValue,
          pl: acc.pl + r.pl,
        }),
        { costBasisTotal: 0, currentValue: 0, pl: 0 }
      ),
    [clientPositions]
  );

  // --- column defs ---
  const symbolColumns: Column<SymbolRow>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      accessor: (r) => r.symbol,
      render: (r) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-surface-3 text-2xs font-bold text-ink-secondary">
            {r.symbol.slice(0, 4)}
          </span>
          <div>
            <p className="font-semibold text-ink">{r.symbol}</p>
            <p className="max-w-[180px] truncate text-xs text-ink-tertiary">{r.company}</p>
          </div>
        </div>
      ),
    },
    { key: 'sector', header: 'Sector', accessor: (r) => r.sector, render: (r) => <Badge tone="neutral">{r.sector}</Badge> },
    { key: 'totalQuantity', header: 'Quantity', accessor: (r) => r.totalQuantity, align: 'right', render: (r) => r.totalQuantity.toLocaleString() },
    { key: 'currentPrice', header: 'Price', accessor: (r) => r.currentPrice, align: 'right', render: (r) => formatCurrency(r.currentPrice) },
    { key: 'totalMarketValue', header: 'Market Value', accessor: (r) => r.totalMarketValue, align: 'right', render: (r) => <span className="font-semibold">{formatCurrency(r.totalMarketValue)}</span> },
    { key: 'accounts', header: 'Accounts', accessor: (r) => r.accounts, align: 'center', defaultHidden: true },
    {
      key: 'changePercent',
      header: 'Return',
      accessor: (r) => r.changePercent,
      align: 'right',
      render: (r) => <PnlPill pct={r.changePercent} />,
    },
    {
      key: 'totalPnL',
      header: 'P&L',
      accessor: (r) => r.totalPnL,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.totalPnL >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.totalPnL)}
        </span>
      ),
    },
  ];

  const clientColumns: Column<ClientRow>[] = [
    {
      key: 'clientName',
      header: 'Client',
      accessor: (r) => r.clientName,
      render: (r) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-active text-2xs font-semibold text-white">
            {r.clientName.slice(0, 2).toUpperCase()}
          </span>
          <span className="font-semibold text-ink group-hover:text-brand">{r.clientName}</span>
          <ChevronRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      ),
    },
    { key: 'holdings', header: 'Holdings', accessor: (r) => r.holdings, align: 'center' },
    { key: 'marketValue', header: 'Market Value', accessor: (r) => r.marketValue, align: 'right', render: (r) => <span className="font-semibold">{formatCurrency(r.marketValue)}</span> },
    { key: 'portfolioValue', header: 'Portfolio Value', accessor: (r) => r.portfolioValue, align: 'right', render: (r) => formatCurrency(r.portfolioValue) },
    {
      key: 'pnl',
      header: 'P&L',
      accessor: (r) => r.pnl,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.pnl >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.pnl)}
        </span>
      ),
    },
  ];

  const clientPositionColumns: Column<ClientPositionRow>[] = [
    { key: 'srNo', header: 'Sr No', accessor: (r) => r.srNo, align: 'center', width: '64px' },
    {
      key: 'symbol',
      header: 'Symbol',
      accessor: (r) => r.symbol,
      render: (r) => <span className="font-semibold text-ink">{r.symbol}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      accessor: (r) => r.name,
      render: (r) => <span className="block max-w-[220px] truncate text-ink-secondary">{r.name}</span>,
    },
    { key: 'quantity', header: 'Quantity', accessor: (r) => r.quantity, align: 'right', render: (r) => r.quantity.toLocaleString() },
    { key: 'averageCostBasis', header: 'Average Cost Basis', accessor: (r) => r.averageCostBasis, align: 'right', render: (r) => formatCurrency(r.averageCostBasis) },
    { key: 'costBasisTotal', header: 'Cost Basis Total', accessor: (r) => r.costBasisTotal, align: 'right', render: (r) => formatCurrency(r.costBasisTotal) },
    { key: 'lastPrice', header: 'Last Price', accessor: (r) => r.lastPrice, align: 'right', render: (r) => formatCurrency(r.lastPrice) },
    {
      key: 'currentValue',
      header: 'Current Value',
      accessor: (r) => r.currentValue,
      align: 'right',
      render: (r) => <span className="font-semibold">{formatCurrency(r.currentValue)}</span>,
    },
    {
      key: 'pl',
      header: 'PL',
      accessor: (r) => r.pl,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.pl >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.pl)}
        </span>
      ),
    },
    {
      key: 'plPercent',
      header: '%PL',
      accessor: (r) => r.plPercent,
      align: 'right',
      render: (r) => <PnlPill pct={r.plPercent} />,
    },
    {
      key: 'allocPercent',
      header: '%Alloc',
      accessor: (r) => r.allocPercent,
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(r.allocPercent, 100)}%` }} />
          </div>
          <span className="w-12 text-right tabular-nums text-ink-secondary">{formatPct(r.allocPercent)}</span>
        </div>
      ),
    },
  ];

  const sectorColumns: Column<SectorRow>[] = [
    {
      key: 'sector',
      header: 'Sector',
      accessor: (r) => r.sector,
      render: (r) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-surface-3 text-ink-secondary">
            <Layers className="h-4 w-4" />
          </span>
          <span className="font-semibold text-ink">{r.sector}</span>
        </div>
      ),
    },
    { key: 'positions', header: 'Positions', accessor: (r) => r.positions, align: 'center' },
    {
      key: 'weight',
      header: 'Weight',
      accessor: (r) => r.weight,
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(r.weight, 100)}%` }} />
          </div>
          <span className="w-12 text-right tabular-nums text-ink-secondary">{formatPct(r.weight)}</span>
        </div>
      ),
    },
    { key: 'marketValue', header: 'Market Value', accessor: (r) => r.marketValue, align: 'right', render: (r) => <span className="font-semibold">{formatCurrency(r.marketValue)}</span> },
    {
      key: 'pnl',
      header: 'P&L',
      accessor: (r) => r.pnl,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.pnl >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.pnl)}
        </span>
      ),
    },
  ];

  const allColumns: Column<HoldingRow>[] = [
    {
      key: 'ticker',
      header: 'Symbol',
      accessor: (r) => r.ticker,
      render: (r) => (
        <div>
          <p className="font-semibold text-ink">{r.ticker}</p>
          <p className="max-w-[160px] truncate text-xs text-ink-tertiary">{r.company}</p>
        </div>
      ),
    },
    { key: 'client', header: 'Client', accessor: (r) => r.client?.name ?? '', render: (r) => r.client?.name ?? '—' },
    { key: 'sector', header: 'Sector', accessor: (r) => r.sector, render: (r) => <Badge tone="neutral">{r.sector}</Badge>, defaultHidden: true },
    { key: 'quantity', header: 'Qty', accessor: (r) => r.quantity, align: 'right', render: (r) => r.quantity.toLocaleString() },
    { key: 'averageCost', header: 'Avg Cost', accessor: (r) => r.averageCost, align: 'right', render: (r) => formatCurrency(r.averageCost) },
    { key: 'currentPrice', header: 'Price', accessor: (r) => r.currentPrice, align: 'right', render: (r) => formatCurrency(r.currentPrice) },
    { key: 'marketValue', header: 'Market Value', accessor: (r) => r.marketValue, align: 'right', render: (r) => <span className="font-semibold">{formatCurrency(r.marketValue)}</span> },
    {
      key: 'unrealizedPnL',
      header: 'P&L',
      accessor: (r) => r.unrealizedPnL,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.unrealizedPnL >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.unrealizedPnL)}
        </span>
      ),
    },
  ];

  return (
    <AppShell
      title="Holdings & Allocations"
      subtitle="Consolidated positions across every managed account"
      actions={
        <Button leftIcon={<Tag className="h-4 w-4" />} onClick={() => (window.location.href = '/symbols/add')}>
          Add Position
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryTile icon={<Wallet className="h-4 w-4" />} label="Total Market Value" value={formatCompactCurrency(totalMv)} />
          <SummaryTile
            icon={<TrendingUp className="h-4 w-4" />}
            label="Unrealized P&L"
            value={formatSignedCurrency(totalPnl)}
            tone={totalPnl >= 0 ? 'success' : 'danger'}
          />
          <SummaryTile icon={<Briefcase className="h-4 w-4" />} label="Positions" value={String(holdings.length)} />
          <SummaryTile icon={<Layers className="h-4 w-4" />} label="Unique Symbols" value={String(symbolRows.length)} />
        </div>

        {/* View switch */}
        <div className="flex items-center justify-between">
          <Tabs
            tabs={[
              { value: 'symbols', label: 'By Symbol', count: symbolRows.length },
              { value: 'clients', label: 'By Client', count: clientRows.length },
              { value: 'sectors', label: 'By Sector', count: sectorRows.length },
              { value: 'all', label: 'All Positions', count: holdings.length },
            ]}
            value={view}
            onChange={(v) => setView(v as typeof view)}
          />
        </div>

        {/* Tables */}
        {view === 'symbols' && (
          <DataTable
            columns={symbolColumns}
            data={symbolRows}
            loading={loading}
            rowKey={(r) => r.symbol}
            searchPlaceholder="Search symbols or companies…"
            onExport={(rows) => {
              exportToCsv('holdings-by-symbol.csv', symbolColumns, rows);
              toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
            }}
            emptyTitle="No symbols yet"
            emptyDescription="Add your first position to populate holdings."
          />
        )}

        {view === 'clients' && (
          <DataTable
            columns={clientColumns}
            data={clientRows}
            loading={loading}
            rowKey={(r) => r.clientId}
            searchPlaceholder="Search clients…"
            onRowClick={(r) => setActiveClient(r)}
            onExport={(rows) => {
              exportToCsv('holdings-by-client.csv', clientColumns, rows);
              toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
            }}
          />
        )}

        {view === 'sectors' && (
          <DataTable
            columns={sectorColumns}
            data={sectorRows}
            loading={loading}
            rowKey={(r) => r.sector}
            searchPlaceholder="Search sectors…"
            onExport={(rows) => {
              exportToCsv('holdings-by-sector.csv', sectorColumns, rows);
              toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
            }}
          />
        )}

        {view === 'all' && (
          <DataTable
            columns={allColumns}
            data={holdings}
            loading={loading}
            rowKey={(r) => r.id}
            selectable
            searchPlaceholder="Search positions…"
            bulkActions={(rows) => (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                onClick={() => toast({ tone: 'warning', title: `${rows.length} positions flagged for review` })}
              >
                Flag
              </Button>
            )}
            onExport={(rows) => {
              exportToCsv('all-positions.csv', allColumns, rows);
              toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
            }}
          />
        )}
      </div>

      {/* Client drill-down */}
      <Drawer
        isOpen={!!activeClient}
        onClose={() => setActiveClient(null)}
        title={activeClient ? `${activeClient.clientName} — Holdings` : ''}
        description={
          activeClient
            ? `${clientPositions.length} position${clientPositions.length === 1 ? '' : 's'} · ${formatCurrency(
                clientTotals.currentValue
              )} current value`
            : ''
        }
        width={1180}
        maximizable
      >
        {activeClient && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <SummaryTile icon={<Wallet className="h-4 w-4" />} label="Cost Basis" value={formatCurrency(clientTotals.costBasisTotal)} />
              <SummaryTile icon={<Briefcase className="h-4 w-4" />} label="Current Value" value={formatCurrency(clientTotals.currentValue)} />
              <SummaryTile
                icon={<TrendingUp className="h-4 w-4" />}
                label="Unrealized P&L"
                value={formatSignedCurrency(clientTotals.pl)}
                tone={clientTotals.pl >= 0 ? 'success' : 'danger'}
              />
              <SummaryTile
                icon={<Layers className="h-4 w-4" />}
                label="Return"
                value={formatSignedPct(
                  clientTotals.costBasisTotal ? (clientTotals.pl / clientTotals.costBasisTotal) * 100 : 0
                )}
                tone={clientTotals.pl >= 0 ? 'success' : 'danger'}
              />
            </div>

            <DataTable
              columns={clientPositionColumns}
              data={clientPositions}
              rowKey={(r) => r.id}
              pageSize={20}
              searchPlaceholder="Search symbols or names…"
              onExport={(rows) => {
                exportToCsv(`${activeClient.clientName}-holdings.csv`, clientPositionColumns, rows);
                toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
              }}
              emptyTitle="No positions"
              emptyDescription="This client has no open positions."
            />
          </div>
        )}
      </Drawer>
    </AppShell>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <Card padding="md" hover>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-surface-3 text-ink-secondary">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-ink-secondary">{label}</p>
          <p
            className={cn(
              'value-display text-lg font-semibold',
              tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink'
            )}
          >
            {value}
          </p>
        </div>
      </div>
    </Card>
  );
}

function PnlPill({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
        up ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
      )}
    >
      {formatSignedPct(pct)}
    </span>
  );
}
