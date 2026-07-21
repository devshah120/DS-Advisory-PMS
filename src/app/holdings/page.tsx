'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  TrendingUp,
  Layers,
  Wallet,
  Trash2,
  Tag,
  ChevronRight,
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { holdingsApi, type BulkImportSummary } from '@/lib/holdings.api';
import { downloadClientHoldingsWorkbook } from '@/lib/holdingsExport';
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
  Modal,
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

/**
 * One position inside a sector's drill-down. Same shape as the client
 * drill-down plus the owning client, since a sector spans many accounts.
 */
interface SectorPositionRow extends ClientPositionRow {
  clientName: string;
}

export default function HoldingsPage() {
  const { toast } = useToast();
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'symbols' | 'clients' | 'sectors' | 'all'>('symbols');
  const [activeClient, setActiveClient] = useState<ClientRow | null>(null);
  const [activeSector, setActiveSector] = useState<SectorRow | null>(null);

  // --- bulk import ---
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- delete a position ---
  // Holds the row awaiting confirmation; deleting is irreversible, so it is
  // never done straight off the click.
  const [pendingDelete, setPendingDelete] = useState<ClientPositionRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function loadHoldings() {
    try {
      const res = await apiClient.getClient().get('/holdings');
      setHoldings(res.data);
    } catch {
      toast({ tone: 'error', title: 'Failed to load holdings' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHoldings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openImport() {
    setImportFile(null);
    setImportResult(null);
    setImportOpen(true);
  }

  function closeImport() {
    if (importing) return;
    setImportOpen(false);
  }

  async function handleDownloadTemplate() {
    try {
      await holdingsApi.downloadTemplate();
      toast({ tone: 'success', title: 'Sample downloaded', description: 'transactions-import-sample.xlsx' });
    } catch {
      toast({ tone: 'error', title: 'Could not download the sample file' });
    }
  }

  async function handleImport() {
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const summary = await holdingsApi.bulkImport(importFile);

      if ((summary as BulkImportSummary & { mock?: boolean }).mock) {
        toast({
          tone: 'warning',
          title: 'Mock mode',
          description: 'Bulk import needs the live API. Set NEXT_PUBLIC_USE_MOCK=false.',
        });
        setImportResult(summary);
        return;
      }

      setImportResult(summary);
      await loadHoldings();

      if (summary.failed === 0) {
        toast({ tone: 'success', title: 'Import complete', description: `${summary.imported} position${summary.imported === 1 ? '' : 's'} imported` });
      } else {
        toast({
          tone: summary.imported > 0 ? 'warning' : 'error',
          title: 'Import finished with issues',
          description: `${summary.imported} imported · ${summary.failed} failed`,
        });
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.message ??
        (typeof err?.message === 'string' ? err.message : 'Import failed');
      toast({ tone: 'error', title: 'Import failed', description: String(message) });
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await holdingsApi.remove(pendingDelete.id);
      setPendingDelete(null);
      await loadHoldings();
      toast({
        tone: 'success',
        title: 'Position deleted',
        description: `${pendingDelete.symbol} removed from this account.`,
      });
    } catch (err: any) {
      const message =
        err?.response?.data?.message ??
        (typeof err?.message === 'string' ? err.message : 'Delete failed');
      toast({ tone: 'error', title: 'Could not delete position', description: String(message) });
    } finally {
      setDeleting(false);
    }
  }

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

  /** Positions belonging to the sector opened in the drill-down drawer. */
  const sectorPositions: SectorPositionRow[] = useMemo(() => {
    if (!activeSector) return [];
    // Match the same fallback the sector rollup uses, so an unlabelled
    // position opens under "Uncategorized" instead of vanishing.
    const inSector = holdings.filter(
      (h) => (h.sector || 'Uncategorized') === activeSector.sector
    );
    const total = inSector.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
    return inSector
      .slice()
      .sort((a, b) => b.quantity * b.currentPrice - a.quantity * a.currentPrice)
      .map((h, i) => {
        const costBasisTotal = h.averageCost * h.quantity;
        const currentValue = h.quantity * h.currentPrice;
        const pl = currentValue - costBasisTotal;
        return {
          id: h.id,
          srNo: i + 1,
          symbol: h.ticker,
          name: h.company,
          clientName: h.client?.name ?? 'Unknown',
          quantity: h.quantity,
          averageCostBasis: h.averageCost,
          costBasisTotal,
          lastPrice: h.currentPrice,
          currentValue,
          pl,
          plPercent: costBasisTotal ? (pl / costBasisTotal) * 100 : 0,
          // Weight within the sector, not the whole book.
          allocPercent: total ? (currentValue / total) * 100 : 0,
        };
      });
  }, [holdings, activeSector]);

  const sectorTotals = useMemo(
    () =>
      sectorPositions.reduce(
        (acc, r) => ({
          costBasisTotal: acc.costBasisTotal + r.costBasisTotal,
          currentValue: acc.currentValue + r.currentValue,
          pl: acc.pl + r.pl,
        }),
        { costBasisTotal: 0, currentValue: 0, pl: 0 }
      ),
    [sectorPositions]
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
    {
      key: 'actions',
      header: '',
      // Chrome, not data: kept out of the column menu and the CSV export. The
      // accessor still feeds the free-text search, so it returns nothing —
      // the symbol is already searchable through its own column.
      meta: true,
      accessor: () => '',
      sortable: false,
      align: 'center',
      width: '56px',
      render: (r) => (
        <button
          type="button"
          aria-label={`Delete ${r.symbol}`}
          title={`Delete ${r.symbol}`}
          onClick={(e) => {
            // The drawer's table has no row click today, but stopping here keeps
            // the button safe if one is ever added.
            e.stopPropagation();
            setPendingDelete(r);
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-[8px] text-ink-tertiary transition-colors hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ];

  const sectorPositionColumns: Column<SectorPositionRow>[] = [
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
    {
      key: 'clientName',
      header: 'Client',
      accessor: (r) => r.clientName,
      render: (r) => <span className="text-ink-secondary">{r.clientName}</span>,
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
      header: '%Sector',
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
          <span className="font-semibold text-ink group-hover:text-brand">{r.sector}</span>
          <ChevronRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
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
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            leftIcon={<Upload className="h-4 w-4" />}
            onClick={openImport}
          >
            Bulk Import
          </Button>
          <Button leftIcon={<Tag className="h-4 w-4" />} onClick={() => (window.location.href = '/symbols/add')}>
            Add Position
          </Button>
        </div>
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
            onRowClick={(r) => setActiveSector(r)}
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
                downloadClientHoldingsWorkbook(activeClient.clientName, rows)
                  .then(() =>
                    toast({
                      tone: 'success',
                      title: 'Exported',
                      description: `${rows.length} rows downloaded`,
                    })
                  )
                  .catch(() => toast({ tone: 'error', title: 'Export failed' }));
              }}
              emptyTitle="No positions"
              emptyDescription="This client has no open positions."
            />
          </div>
        )}
      </Drawer>

      {/* Delete confirmation */}
      <Modal
        isOpen={!!pendingDelete}
        onClose={() => {
          if (!deleting) setPendingDelete(null);
        }}
        title="Delete this position?"
        description={
          pendingDelete
            ? `${pendingDelete.symbol} — ${pendingDelete.name}`
            : undefined
        }
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              leftIcon={<Trash2 className="h-4 w-4" />}
              onClick={handleDelete}
              loading={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete position'}
            </Button>
          </div>
        }
      >
        {pendingDelete && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <ConfirmField label="Quantity" value={pendingDelete.quantity.toLocaleString()} />
              <ConfirmField label="Average Cost" value={formatCurrency(pendingDelete.averageCostBasis)} />
              <ConfirmField label="Current Value" value={formatCurrency(pendingDelete.currentValue)} />
              <ConfirmField
                label="Unrealized P&L"
                value={formatSignedCurrency(pendingDelete.pl)}
                tone={pendingDelete.pl >= 0 ? 'success' : 'danger'}
              />
            </div>
            <p className="text-xs text-ink-tertiary">
              This removes the position from
              {activeClient ? ` ${activeClient.clientName}'s` : ' this'} account and cannot be undone. Any
              transactions already recorded against {pendingDelete.symbol} stay on the ledger — delete those from
              the Transactions page if the trade itself was wrong.
            </p>
          </div>
        )}
      </Modal>

      {/* Sector drill-down */}
      <Drawer
        isOpen={!!activeSector}
        onClose={() => setActiveSector(null)}
        title={activeSector ? `${activeSector.sector} — Positions` : ''}
        description={
          activeSector
            ? `${sectorPositions.length} position${sectorPositions.length === 1 ? '' : 's'} · ${formatCurrency(
                sectorTotals.currentValue
              )} current value · ${formatPct(activeSector.weight)} of book`
            : ''
        }
        width={1180}
        maximizable
      >
        {activeSector && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <SummaryTile icon={<Wallet className="h-4 w-4" />} label="Cost Basis" value={formatCurrency(sectorTotals.costBasisTotal)} />
              <SummaryTile icon={<Briefcase className="h-4 w-4" />} label="Current Value" value={formatCurrency(sectorTotals.currentValue)} />
              <SummaryTile
                icon={<TrendingUp className="h-4 w-4" />}
                label="Unrealized P&L"
                value={formatSignedCurrency(sectorTotals.pl)}
                tone={sectorTotals.pl >= 0 ? 'success' : 'danger'}
              />
              <SummaryTile
                icon={<Layers className="h-4 w-4" />}
                label="Return"
                value={formatSignedPct(
                  sectorTotals.costBasisTotal ? (sectorTotals.pl / sectorTotals.costBasisTotal) * 100 : 0
                )}
                tone={sectorTotals.pl >= 0 ? 'success' : 'danger'}
              />
            </div>

            <DataTable
              columns={sectorPositionColumns}
              data={sectorPositions}
              rowKey={(r) => r.id}
              pageSize={20}
              searchPlaceholder="Search symbols, names or clients…"
              onExport={(rows) => {
                exportToCsv(`${activeSector.sector}-positions.csv`, sectorPositionColumns, rows);
                toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
              }}
              emptyTitle="No positions"
              emptyDescription="This sector has no open positions."
            />
          </div>
        )}
      </Drawer>

      {/* Bulk import */}
      <Modal
        isOpen={importOpen}
        onClose={closeImport}
        title="Bulk Import Transactions"
        description="Upload an .xlsx or .csv of trades. Each row imports through the same path as a single Add Position — repeated symbols fold into the existing lot at weighted-average cost — and also records a dated buy/sell transaction."
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" leftIcon={<Download className="h-4 w-4" />} onClick={handleDownloadTemplate}>
              Download sample .xlsx
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={closeImport} disabled={importing}>
                {importResult ? 'Close' : 'Cancel'}
              </Button>
              <Button
                leftIcon={<Upload className="h-4 w-4" />}
                onClick={handleImport}
                disabled={!importFile || importing}
                loading={importing}
              >
                {importing ? 'Importing…' : 'Import'}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {/* File picker */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full items-center gap-3 rounded-[12px] border border-dashed border-border bg-surface-2 px-4 py-5 text-left transition-colors hover:border-brand hover:bg-surface-3"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-surface-3 text-ink-secondary">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">
                {importFile ? importFile.name : 'Choose a file to import'}
              </p>
              <p className="text-xs text-ink-tertiary">
                {importFile
                  ? `${(importFile.size / 1024).toFixed(1)} KB · click to replace`
                  : 'Accepts .xlsx, .xls or .csv'}
              </p>
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="hidden"
            onChange={(e) => {
              setImportFile(e.target.files?.[0] ?? null);
              setImportResult(null);
              // Allow re-selecting the same file after a failed run.
              e.target.value = '';
            }}
          />

          <p className="text-xs text-ink-tertiary">
            Columns: <span className="font-medium text-ink-secondary">Action, Date, Client Name, Symbol, Quantity, Amount Invested</span>.
            Company, sector, industry, country, exchange, theme, average cost and the live price are all filled in
            automatically from the symbol — the same details the Add Position screen resolves for you.
          </p>

          {/* Result summary */}
          {importResult && !(importResult as any).mock && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <ResultTile label="Total rows" value={importResult.total} />
                <ResultTile label="Imported" value={importResult.imported} tone="success" />
                <ResultTile label="Failed" value={importResult.failed} tone={importResult.failed ? 'danger' : undefined} />
              </div>

              {importResult.results.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded-[12px] border border-border">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-surface-2 text-xs text-ink-tertiary">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Row</th>
                        <th className="px-3 py-2 text-left font-medium">Ticker</th>
                        <th className="px-3 py-2 text-left font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.results.map((r) => (
                        <tr key={r.row} className="border-t border-border">
                          <td className="px-3 py-2 tabular-nums text-ink-secondary">{r.row}</td>
                          <td className="px-3 py-2 font-medium text-ink">{r.ticker ?? '—'}</td>
                          <td className="px-3 py-2">
                            {r.status === 'imported' ? (
                              <span className="inline-flex items-center gap-1 text-success">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Imported
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-danger">
                                <XCircle className="h-3.5 w-3.5" /> {r.error ?? 'Failed'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </AppShell>
  );
}

function ConfirmField({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="rounded-[10px] border border-border bg-surface-2 px-3 py-2">
      <p className="text-xs text-ink-secondary">{label}</p>
      <p
        className={cn(
          'tabular-nums text-sm font-semibold',
          tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink'
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ResultTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger';
}) {
  return (
    <div className="rounded-[12px] border border-border bg-surface-2 px-3 py-2.5">
      <p className="text-xs text-ink-secondary">{label}</p>
      <p
        className={cn(
          'value-display text-xl font-semibold',
          tone === 'success' ? 'text-success' : tone === 'danger' ? 'text-danger' : 'text-ink'
        )}
      >
        {value}
      </p>
    </div>
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
