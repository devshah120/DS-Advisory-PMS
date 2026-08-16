'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Briefcase,
  TrendingUp,
  Layers,
  Wallet,
  PiggyBank,
  Trash2,
  Tag,
  Users,
  ChevronRight,
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { apiClient } from '@/lib/api';
import { clientsApi } from '@/lib/clients.api';
import { holdingsApi, type BulkImportSummary } from '@/lib/holdings.api';
import { familiesApi } from '@/lib/families.api';
import {
  downloadClientHoldingsWorkbook,
  downloadFamilyHoldingsWorkbook,
  type HoldingsExportRow,
} from '@/lib/holdingsExport';
import {
  formatCurrency,
  formatCompactCurrency,
  formatSignedCurrency,
  formatPct,
  formatSignedPct,
  cn,
} from '@/lib/utils';
import { Holding, Client, Family, FamilyAggregate, FamilyPosition } from '@/types';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import { useMarket } from '@/components/layout/MarketContext';
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
  /** Idle cash the client holds — buying power for deployment, not deployed capital. */
  cashBalance: number;
  /** Cash as a share of (holdings + cash). What's undeployed right now. */
  cashWeight: number;
}

interface SectorRow {
  sector: string;
  positions: number;
  marketValue: number;
  pnl: number;
  weight: number;
}

/**
 * A household in the "By Client" table.
 *
 * Families sit alongside individual mandates rather than replacing them: the
 * desk reasons about both, and an account is not "gone" because it belongs to
 * a family. Figures here are the merged household totals, so a stock held in
 * three of the family's accounts contributes its combined size once.
 */
interface FamilyRow {
  familyId: string;
  familyName: string;
  /** How many mandates the household holds. */
  accounts: number;
  /** Distinct symbols AFTER merging — the household's real name count. */
  positions: number;
  marketValue: number;
  pnl: number;
  cashBalance: number;
  portfolioValue: number;
}

/** One position inside a client's drill-down, mirroring the portfolio sheet layout. */
interface ClientPositionRow {
  id: string;
  srNo: number;
  symbol: string;
  name: string;
  sector: string;
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

/**
 * One client's holding of a single symbol, shown in the symbol drill-down.
 * %Alloc here is the weight of this lot inside that client's own portfolio,
 * not inside the symbol aggregate — so an advisor can see how large a bet
 * each account has placed on the name.
 */
interface SymbolHolderRow extends ClientPositionRow {
  clientName: string;
}

/**
 * A client who does NOT hold the symbol in the open drawer — the deployment
 * shortlist. Deliberately not a `SymbolHolderRow` with zeros: there is no lot,
 * so quantity/cost/P&L are not "0", they are absent, and inventing zero columns
 * would make an un-owned name look like a closed position.
 */
interface SymbolNonHolderRow {
  id: string;
  srNo: number;
  clientName: string;
  /** Live book value (holdings only), summed from the same lots the table shows. */
  bookValue: number;
  /** Idle cash — the money actually available to buy this name with. */
  cashBalance: number;
}

/**
 * Drops fully-exited positions from a holdings payload.
 *
 * The API already filters these, so this is a second line of defence rather
 * than the fix: a sold-out lot keeps its row in the database (it carries the
 * realized P&L the sale booked), and the one thing it must never do is come
 * back as a $0.00 line on the holdings table or in an exported workbook.
 *
 * Fractional quantities mean a full exit rarely nets to exactly 0 — the
 * subtraction leaves float dust — so this compares against an epsilon, matching
 * the threshold the API uses for the same judgement.
 */
const CLOSED_POSITION_EPSILON = 1e-9;

function openPositions<T extends { quantity: number }>(rows: T[]): T[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((h) => Math.abs(Number(h.quantity) || 0) > CLOSED_POSITION_EPSILON);
}

export default function HoldingsPage() {
  const { toast } = useToast();
  // The selected book. `currency` drives every money column on this page, so an
  // Indian portfolio renders in rupees with lakh/crore grouping throughout.
  const { market, meta, ready: marketReady } = useMarket();
  const currency = meta.currency;
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  /**
   * The full client roster. /holdings alone cannot answer "who does NOT own
   * this" — a client with no position in a symbol contributes no row to it, and
   * a client with an empty book contributes no rows at all, so they would be
   * invisible precisely when they are the most obvious deployment target.
   */
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'symbols' | 'clients' | 'sectors' | 'all'>('symbols');
  const [activeClient, setActiveClient] = useState<ClientRow | null>(null);
  const [activeSector, setActiveSector] = useState<SectorRow | null>(null);
  const [activeSymbol, setActiveSymbol] = useState<SymbolRow | null>(null);

  // --- families (households) ---
  /** The book's households, listed beside individual clients in the By Client tab. */
  const [families, setFamilies] = useState<Family[]>([]);
  const [activeFamily, setActiveFamily] = useState<FamilyRow | null>(null);
  /**
   * The opened household's merged portfolio, fetched on demand.
   *
   * Deliberately server-side rather than merged in the browser from `holdings`:
   * the API values every lot at a live quote and blends cost by weight, and
   * duplicating that arithmetic here is exactly how two screens end up
   * disagreeing about what a family owns.
   */
  const [familyAggregate, setFamilyAggregate] = useState<FamilyAggregate | null>(null);
  const [familyLoading, setFamilyLoading] = useState(false);

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

  // --- historical holdings ---
  const [historicalDate, setHistoricalDate] = useState<string>('');
  const [loadingHistorical, setLoadingHistorical] = useState(false);

  async function loadHoldings() {
    try {
      // Scoped to the selected book — the Indian and US books are separate
      // portfolios and must never appear in one table, not least because their
      // market values are in different currencies.
      const res = await apiClient.getClient().get('/holdings', { params: { market } });
      setHoldings(openPositions(res.data));
    } catch {
      toast({ tone: 'error', title: 'Failed to load holdings' });
    } finally {
      setLoading(false);
    }
  }

  /**
   * The roster powers only the "not held by" panel inside the symbol drawer, so
   * a failure here must not take the page down with it — holdings are what this
   * screen is for. On failure the panel degrades to an explanatory empty state
   * rather than silently showing a short list, which would read as "everyone
   * already owns this" and is the one wrong answer worth guarding against.
   */
  async function loadClients() {
    try {
      // limit is deliberately high: this is a book of a handful of mandates and
      // the panel is only correct if it sees every one of them. A default page
      // size would quietly truncate the roster and under-report non-holders.
      setAllClients(await clientsApi.list({ limit: 500, market }));
    } catch {
      setAllClients([]);
    }
  }

  /**
   * The book's households. A failure here leaves the client table showing
   * individual mandates only — the page's primary job — rather than failing.
   */
  async function loadFamilies() {
    try {
      setFamilies(await familiesApi.list(market));
    } catch {
      setFamilies([]);
    }
  }

  // Reloaded on every book change, so switching country re-scopes the whole
  // page rather than leaving the previous book's positions on screen.
  useEffect(() => {
    if (!marketReady) return;
    setLoading(true);
    loadHoldings();
    loadClients();
    loadFamilies();
    // A household from the previous book must not stay open across a switch.
    setActiveFamily(null);
    setFamilyAggregate(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, marketReady]);

  // The merged household portfolio is fetched when one is opened, not upfront:
  // it costs a live quote per distinct symbol, and most sessions never open one.
  useEffect(() => {
    if (!activeFamily) {
      setFamilyAggregate(null);
      return;
    }

    let cancelled = false;
    setFamilyLoading(true);
    familiesApi
      .aggregate(activeFamily.familyId)
      .then((data) => !cancelled && setFamilyAggregate(data))
      .catch(() => {
        if (cancelled) return;
        setFamilyAggregate(null);
        toast({ tone: 'error', title: 'Could not load the family portfolio' });
      })
      .finally(() => !cancelled && setFamilyLoading(false));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamily]);

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

  async function handleExportHistoricalHoldings() {
    if (!activeClient || !historicalDate) return;

    setLoadingHistorical(true);
    try {
      const asOfDate = new Date(historicalDate);
      const historicalHoldings = await holdingsApi.getPortfolioAsOfDate(activeClient.clientId, asOfDate);

      const rows: ClientPositionRow[] = openPositions<any>(historicalHoldings)
        .sort((a: any, b: any) => b.marketValue - a.marketValue)
        .map((h: any, i: number) => {
          const costBasisTotal = h.averageCost * h.quantity;
          const currentValue = h.quantity * h.currentPrice;
          const pl = currentValue - costBasisTotal;
          const total = clientTotals.currentValue + activeClient.cashBalance;

          return {
            id: h.id,
            srNo: i + 1,
            symbol: h.ticker,
            name: h.company,
            sector: h.sector || 'Uncategorized',
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

      const formattedDate = historicalDate.replace(/-/g, '_');
      const filename = `${activeClient.clientName.replace(/\s+/g, '_').toLowerCase()}-holdings-as-of-${formattedDate}`;

      const totalHistorical = rows.reduce(
        (acc, r) => ({
          costBasisTotal: acc.costBasisTotal + r.costBasisTotal,
          currentValue: acc.currentValue + r.currentValue,
          pl: acc.pl + r.pl,
        }),
        { costBasisTotal: 0, currentValue: 0, pl: 0 }
      );

      await downloadClientHoldingsWorkbook(filename, rows, activeClient.cashBalance);
      toast({
        tone: 'success',
        title: 'Historical holdings exported',
        description: `Portfolio as of ${historicalDate} downloaded`,
      });
      setHistoricalDate('');
    } catch (err: any) {
      const message =
        err?.response?.data?.message ??
        (typeof err?.message === 'string' ? err.message : 'Export failed');
      toast({ tone: 'error', title: 'Could not export historical holdings', description: String(message) });
    } finally {
      setLoadingHistorical(false);
    }
  }

  /**
   * The household's merged book as the firm's formatted workbook — the same
   * sheet an individual client's export produces, so a family review and a
   * single-mandate review hand the client the same-looking document.
   *
   * Rows arrive already sorted and filtered by the table, so whatever the user
   * is looking at is what gets exported. Weight comes from the server's
   * aggregate rather than being recomputed here: it is the share of the whole
   * household portfolio (cash included), and re-deriving it from a filtered
   * subset would silently rebase every percentage.
   */
  async function handleExportFamily(rows: FamilyPosition[]) {
    if (!activeFamily || !familyAggregate) return;

    const exportRows: HoldingsExportRow[] = rows.map((p, i) => ({
      srNo: i + 1,
      symbol: p.displayTicker,
      name: p.company,
      sector: p.sector || 'Uncategorized',
      quantity: p.quantity,
      averageCostBasis: p.averageCost,
      costBasisTotal: p.costBasis,
      lastPrice: p.currentPrice,
      currentValue: p.marketValue,
      pl: p.unrealizedPnL,
      plPercent: p.unrealizedPnLPercent,
      allocPercent: p.weight,
      accounts: p.accounts,
    }));

    try {
      await downloadFamilyHoldingsWorkbook(
        activeFamily.familyName,
        exportRows,
        familyAggregate.totals.cashBalance,
      );
      toast({
        tone: 'success',
        title: 'Family portfolio exported',
        description: `${exportRows.length} merged position${exportRows.length === 1 ? '' : 's'} downloaded`,
      });
    } catch {
      toast({ tone: 'error', title: 'Could not export the family portfolio' });
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
    const rows = [...map.values()];
    // The Indian book is discussed by company name — a manager says "Finolex
    // Cables", not "FINCABLES.NS" — so it reads as an alphabetical roster of
    // names. The US book stays ordered by conviction (largest position first).
    return market === 'INDIA'
      ? rows.sort((a, b) => (a.company ?? '').localeCompare(b.company ?? '', 'en-IN'))
      : rows.sort((a, b) => b.totalMarketValue - a.totalMarketValue);
  }, [holdings, market]);

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
          // Cash is a property of the client, not the position — read once off the
          // joined record. Portfolio value is derived live (holdings + cash) rather
          // than read from the stale stored column, which is known to drift to $0.
          portfolioValue: 0,
          cashBalance: h.client?.cashBalance ?? 0,
          cashWeight: 0,
        };
      cur.holdings += 1;
      cur.marketValue += h.marketValue;
      cur.pnl += h.unrealizedPnL;
      map.set(h.clientId, cur);
    });
    // Finalize the derived columns once every position has been summed.
    return [...map.values()]
      .map((c) => {
        const portfolioValue = c.marketValue + c.cashBalance;
        return {
          ...c,
          portfolioValue,
          cashWeight: portfolioValue > 0 ? (c.cashBalance / portfolioValue) * 100 : 0,
        };
      })
      .sort((a, b) => b.marketValue - a.marketValue);
  }, [holdings]);

  /**
   * Household summary rows for the By Client table.
   *
   * Derived from the positions already on the page rather than fetched, so the
   * table paints with everything else; the drawer then loads the authoritative
   * merged view. Positions are counted as DISTINCT symbols across the
   * household's accounts — the whole point of a family view is that one name
   * held by four members is one position, not four.
   */
  const familyRows: FamilyRow[] = useMemo(() => {
    if (families.length === 0) return [];

    // clientId -> family, so each lot can be attributed in one pass.
    const familyOf = new Map<string, Family>();
    for (const family of families) {
      for (const member of family.members) familyOf.set(member.id, family);
    }

    const map = new Map<string, FamilyRow & { symbols: Set<string>; clientIds: Set<string> }>();

    for (const h of holdings) {
      const family = familyOf.get(h.clientId);
      if (!family) continue;

      const cur =
        map.get(family.id) ??
        {
          familyId: family.id,
          familyName: family.name,
          accounts: 0,
          positions: 0,
          marketValue: 0,
          pnl: 0,
          cashBalance: 0,
          portfolioValue: 0,
          symbols: new Set<string>(),
          clientIds: new Set<string>(),
        };

      cur.marketValue += h.marketValue;
      cur.pnl += h.unrealizedPnL;
      cur.symbols.add(h.ticker);
      cur.clientIds.add(h.clientId);
      map.set(family.id, cur);
    }

    // Cash comes from the roster, not the lots: a member holding cash but no
    // positions contributes no holding rows at all, and their balance is still
    // the household's buying power.
    const cashOf = new Map(allClients.map((c) => [c.id, c.cashBalance ?? 0]));

    return families
      .map((family) => {
        const acc = map.get(family.id);
        const cashBalance = family.members.reduce((s, m) => s + (cashOf.get(m.id) ?? 0), 0);
        const marketValue = acc?.marketValue ?? 0;
        return {
          familyId: family.id,
          familyName: family.name,
          // Every member counts, including one holding nothing yet.
          accounts: family.members.length,
          positions: acc?.symbols.size ?? 0,
          marketValue,
          pnl: acc?.pnl ?? 0,
          cashBalance,
          portfolioValue: marketValue + cashBalance,
        };
      })
      .sort((a, b) => b.marketValue - a.marketValue);
  }, [families, holdings, allClients]);

  const totalMv = holdings.reduce((s, h) => s + h.marketValue, 0);
  const totalPnl = holdings.reduce((s, h) => s + h.unrealizedPnL, 0);
  // House-wide idle cash, summed per client (never per position, or a client's
  // balance would be counted once for every holding they own).
  const totalCash = clientRows.reduce((s, c) => s + c.cashBalance, 0);

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
    // Weights are a share of the whole portfolio, so idle cash sits in the
    // denominator alongside the positions. A client holding cash is genuinely
    // less exposed to each name than the position values alone would suggest,
    // and the stock weights have to add up to less than 100% to say so.
    const total =
      owned.reduce((s, h) => s + h.quantity * h.currentPrice, 0) + activeClient.cashBalance;
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
          // Same fallback as the sector rollup, so an unlabelled holding lands
          // in one bucket everywhere instead of a blank slice of its own.
          sector: h.sector || 'Uncategorized',
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
          sector: h.sector || 'Uncategorized',
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

  /** Clients holding the symbol opened in the drill-down drawer. */
  const symbolHolders: SymbolHolderRow[] = useMemo(() => {
    if (!activeSymbol) return [];
    const owners = holdings.filter((h) => h.ticker === activeSymbol.symbol);
    // Per-client portfolio totals, computed once, so each lot's %Alloc reflects
    // its weight inside that client's own book rather than the symbol aggregate.
    const clientTotal = new Map<string, number>();
    holdings.forEach((h) => {
      clientTotal.set(
        h.clientId,
        (clientTotal.get(h.clientId) ?? 0) + h.quantity * h.currentPrice
      );
    });
    return owners
      .slice()
      .sort((a, b) => b.quantity * b.currentPrice - a.quantity * a.currentPrice)
      .map((h, i) => {
        const costBasisTotal = h.averageCost * h.quantity;
        const currentValue = h.quantity * h.currentPrice;
        const pl = currentValue - costBasisTotal;
        const portfolioValue = clientTotal.get(h.clientId) ?? 0;
        return {
          id: h.id,
          srNo: i + 1,
          symbol: h.ticker,
          name: h.company,
          sector: h.sector || 'Uncategorized',
          clientName: h.client?.name ?? 'Unknown',
          quantity: h.quantity,
          averageCostBasis: h.averageCost,
          costBasisTotal,
          lastPrice: h.currentPrice,
          currentValue,
          pl,
          plPercent: costBasisTotal ? (pl / costBasisTotal) * 100 : 0,
          allocPercent: portfolioValue ? (currentValue / portfolioValue) * 100 : 0,
        };
      });
  }, [holdings, activeSymbol]);

  const symbolTotals = useMemo(
    () =>
      symbolHolders.reduce(
        (acc, r) => ({
          costBasisTotal: acc.costBasisTotal + r.costBasisTotal,
          currentValue: acc.currentValue + r.currentValue,
          pl: acc.pl + r.pl,
        }),
        { costBasisTotal: 0, currentValue: 0, pl: 0 }
      ),
    [symbolHolders]
  );

  /**
   * The inverse of `symbolHolders`: every client who does NOT hold this symbol.
   *
   * This is the deployment shortlist — the question "who is still to be topped
   * up in this name" is answered by the complement of the holders table, and
   * computing it by hand off the holders list is exactly the kind of thing that
   * goes wrong when a client's book is empty.
   *
   * Ownership is decided by an actual position, not by the presence of a row:
   * a fully-exited lot can linger at quantity 0, and treating that as ownership
   * would hide a client who genuinely has nothing left in the name and is
   * therefore a candidate to re-enter.
   */
  const symbolNonHolders: SymbolNonHolderRow[] = useMemo(() => {
    if (!activeSymbol) return [];

    const ownerIds = new Set(
      holdings
        .filter((h) => h.ticker === activeSymbol.symbol && h.quantity > 0)
        .map((h) => h.clientId)
    );

    // Live book value per client, derived from the lots on screen. The stored
    // Client.portfolioValue is a known-drifting display cache (it reads 0 on
    // live clients holding real money), so it is never used here.
    const bookValue = new Map<string, number>();
    holdings.forEach((h) => {
      bookValue.set(h.clientId, (bookValue.get(h.clientId) ?? 0) + h.quantity * h.currentPrice);
    });

    return allClients
      .filter((c) => !ownerIds.has(c.id))
      // Most buying power first — that is the order the desk acts in.
      .sort((a, b) => (b.cashBalance ?? 0) - (a.cashBalance ?? 0))
      .map((c, i) => ({
        id: c.id,
        srNo: i + 1,
        clientName: c.name,
        bookValue: bookValue.get(c.id) ?? 0,
        cashBalance: c.cashBalance ?? 0,
      }));
  }, [allClients, holdings, activeSymbol]);

  /**
   * Total buying power sitting with clients who don't own this name — the single
   * number that says how much of an opportunity the gap actually represents.
   */
  const nonHolderCash = useMemo(
    () => symbolNonHolders.reduce((s, r) => s + r.cashBalance, 0),
    [symbolNonHolders]
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
            <p className="font-semibold text-ink group-hover:text-brand">{r.symbol}</p>
            <p className="max-w-[180px] truncate text-xs text-ink-tertiary">{r.company}</p>
          </div>
          <ChevronRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      ),
    },
    { key: 'sector', header: 'Sector', accessor: (r) => r.sector, render: (r) => <Badge tone="neutral">{r.sector}</Badge> },
    { key: 'totalQuantity', header: 'Quantity', accessor: (r) => r.totalQuantity, align: 'right', render: (r) => r.totalQuantity.toLocaleString() },
    { key: 'currentPrice', header: 'Price', accessor: (r) => r.currentPrice, align: 'right', render: (r) => formatCurrency(r.currentPrice, currency) },
    { key: 'totalMarketValue', header: 'Market Value', accessor: (r) => r.totalMarketValue, align: 'right', render: (r) => <span className="font-semibold">{formatCurrency(r.totalMarketValue, currency)}</span> },
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
          {formatSignedCurrency(r.totalPnL, currency)}
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
    { key: 'marketValue', header: 'Market Value', accessor: (r) => r.marketValue, align: 'right', render: (r) => <span className="font-semibold">{formatCurrency(r.marketValue, currency)}</span> },
    {
      key: 'cashBalance',
      header: 'Cash',
      accessor: (r) => r.cashBalance,
      align: 'right',
      render: (r) => (
        <span className={cn('tabular-nums', r.cashBalance > 0 ? 'text-ink' : 'text-ink-tertiary')}>
          {formatCurrency(r.cashBalance, currency)}
        </span>
      ),
    },
    {
      key: 'cashWeight',
      header: 'Cash %',
      accessor: (r) => r.cashWeight,
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-warning" style={{ width: `${Math.min(r.cashWeight, 100)}%` }} />
          </div>
          <span className="w-12 text-right tabular-nums text-ink-secondary">{formatPct(r.cashWeight)}</span>
        </div>
      ),
    },
    { key: 'portfolioValue', header: 'Portfolio Value', accessor: (r) => r.portfolioValue, align: 'right', render: (r) => formatCurrency(r.portfolioValue, currency) },
    {
      key: 'pnl',
      header: 'P&L',
      accessor: (r) => r.pnl,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.pnl >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.pnl, currency)}
        </span>
      ),
    },
  ];

  const familyColumns: Column<FamilyRow>[] = [
    {
      key: 'familyName',
      header: 'Family',
      accessor: (r) => r.familyName,
      render: (r) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-warning to-brand-active text-white">
            <Users className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink group-hover:text-brand">{r.familyName}</p>
            <p className="text-2xs text-ink-tertiary">
              {r.accounts} account{r.accounts === 1 ? '' : 's'} combined
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      ),
    },
    {
      key: 'positions',
      header: 'Positions',
      accessor: (r) => r.positions,
      align: 'center',
      // Distinct names after merging — duplicates across the accounts are one.
      render: (r) => <span className="tabular-nums">{r.positions}</span>,
    },
    {
      key: 'marketValue',
      header: 'Market Value',
      accessor: (r) => r.marketValue,
      align: 'right',
      render: (r) => <span className="font-semibold">{formatCurrency(r.marketValue, currency)}</span>,
    },
    {
      key: 'cashBalance',
      header: 'Cash',
      accessor: (r) => r.cashBalance,
      align: 'right',
      render: (r) => (
        <span className={cn('tabular-nums', r.cashBalance > 0 ? 'text-ink' : 'text-ink-tertiary')}>
          {formatCurrency(r.cashBalance, currency)}
        </span>
      ),
    },
    {
      key: 'portfolioValue',
      header: 'Portfolio Value',
      accessor: (r) => r.portfolioValue,
      align: 'right',
      render: (r) => formatCurrency(r.portfolioValue, currency),
    },
    {
      key: 'pnl',
      header: 'P&L',
      accessor: (r) => r.pnl,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.pnl >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.pnl, currency)}
        </span>
      ),
    },
  ];

  /** One merged household position — the family drawer's main table. */
  const familyPositionColumns: Column<FamilyPosition>[] = [
    {
      key: 'displayTicker',
      header: 'Symbol',
      accessor: (r) => r.displayTicker,
      render: (r) => (
        <div>
          <p className="font-semibold text-ink">{r.displayTicker}</p>
          <p className="max-w-[200px] truncate text-2xs text-ink-tertiary">{r.company}</p>
        </div>
      ),
    },
    { key: 'sector', header: 'Sector', accessor: (r) => r.sector },
    {
      key: 'accounts',
      header: 'Accounts',
      accessor: (r) => r.accounts,
      align: 'center',
      // How many of the household's mandates hold the name — 3 of 5 is a real
      // signal about how concentrated the family's conviction is.
      render: (r) => (
        <Badge tone={r.accounts > 1 ? 'brand' : 'neutral'}>{r.accounts}</Badge>
      ),
    },
    {
      key: 'quantity',
      header: 'Quantity',
      accessor: (r) => r.quantity,
      align: 'right',
      render: (r) => r.quantity.toLocaleString(undefined, { maximumFractionDigits: 4 }),
    },
    {
      key: 'averageCost',
      header: 'Avg. Cost',
      accessor: (r) => r.averageCost,
      align: 'right',
      // Cost-weighted across the accounts, not the mean of their averages.
      render: (r) => formatCurrency(r.averageCost, currency),
    },
    {
      key: 'costBasis',
      header: 'Cost Basis',
      accessor: (r) => r.costBasis,
      align: 'right',
      render: (r) => formatCurrency(r.costBasis, currency),
    },
    {
      key: 'currentPrice',
      header: 'Last Price',
      accessor: (r) => r.currentPrice,
      align: 'right',
      render: (r) => formatCurrency(r.currentPrice, currency),
    },
    {
      key: 'marketValue',
      header: 'Current Value',
      accessor: (r) => r.marketValue,
      align: 'right',
      render: (r) => <span className="font-semibold">{formatCurrency(r.marketValue, currency)}</span>,
    },
    {
      key: 'unrealizedPnL',
      header: 'PL',
      accessor: (r) => r.unrealizedPnL,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.unrealizedPnL >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.unrealizedPnL, currency)}
        </span>
      ),
    },
    {
      key: 'unrealizedPnLPercent',
      header: '%PL',
      accessor: (r) => r.unrealizedPnLPercent,
      align: 'right',
      render: (r) => <PnlPill pct={r.unrealizedPnLPercent} />,
    },
    {
      key: 'weight',
      header: '%Alloc',
      accessor: (r) => r.weight,
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(r.weight, 100)}%` }} />
          </div>
          <span className="w-12 text-right tabular-nums text-ink-secondary">{formatPct(r.weight)}</span>
        </div>
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
    { key: 'averageCostBasis', header: 'Average Cost Basis', accessor: (r) => r.averageCostBasis, align: 'right', render: (r) => formatCurrency(r.averageCostBasis, currency) },
    { key: 'costBasisTotal', header: 'Cost Basis Total', accessor: (r) => r.costBasisTotal, align: 'right', render: (r) => formatCurrency(r.costBasisTotal, currency) },
    { key: 'lastPrice', header: 'Last Price', accessor: (r) => r.lastPrice, align: 'right', render: (r) => formatCurrency(r.lastPrice, currency) },
    {
      key: 'currentValue',
      header: 'Current Value',
      accessor: (r) => r.currentValue,
      align: 'right',
      render: (r) => <span className="font-semibold">{formatCurrency(r.currentValue, currency)}</span>,
    },
    {
      key: 'pl',
      header: 'PL',
      accessor: (r) => r.pl,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.pl >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.pl, currency)}
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
    { key: 'averageCostBasis', header: 'Average Cost Basis', accessor: (r) => r.averageCostBasis, align: 'right', render: (r) => formatCurrency(r.averageCostBasis, currency) },
    { key: 'costBasisTotal', header: 'Cost Basis Total', accessor: (r) => r.costBasisTotal, align: 'right', render: (r) => formatCurrency(r.costBasisTotal, currency) },
    { key: 'lastPrice', header: 'Last Price', accessor: (r) => r.lastPrice, align: 'right', render: (r) => formatCurrency(r.lastPrice, currency) },
    {
      key: 'currentValue',
      header: 'Current Value',
      accessor: (r) => r.currentValue,
      align: 'right',
      render: (r) => <span className="font-semibold">{formatCurrency(r.currentValue, currency)}</span>,
    },
    {
      key: 'pl',
      header: 'PL',
      accessor: (r) => r.pl,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.pl >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.pl, currency)}
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

  const symbolHolderColumns: Column<SymbolHolderRow>[] = [
    { key: 'srNo', header: 'Sr No', accessor: (r) => r.srNo, align: 'center', width: '64px' },
    {
      key: 'clientName',
      header: 'Client',
      accessor: (r) => r.clientName,
      render: (r) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-active text-2xs font-semibold text-white">
            {r.clientName.slice(0, 2).toUpperCase()}
          </span>
          <span className="font-semibold text-ink">{r.clientName}</span>
        </div>
      ),
    },
    { key: 'quantity', header: 'Quantity', accessor: (r) => r.quantity, align: 'right', render: (r) => r.quantity.toLocaleString() },
    { key: 'averageCostBasis', header: 'Average Cost Basis', accessor: (r) => r.averageCostBasis, align: 'right', render: (r) => formatCurrency(r.averageCostBasis, currency) },
    { key: 'costBasisTotal', header: 'Cost Basis Total', accessor: (r) => r.costBasisTotal, align: 'right', render: (r) => formatCurrency(r.costBasisTotal, currency) },
    { key: 'lastPrice', header: 'Last Price', accessor: (r) => r.lastPrice, align: 'right', render: (r) => formatCurrency(r.lastPrice, currency) },
    {
      key: 'currentValue',
      header: 'Current Value',
      accessor: (r) => r.currentValue,
      align: 'right',
      render: (r) => <span className="font-semibold">{formatCurrency(r.currentValue, currency)}</span>,
    },
    {
      key: 'pl',
      header: 'PL',
      accessor: (r) => r.pl,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.pl >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.pl, currency)}
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
      header: '%Portfolio',
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

  /**
   * Non-holders carry no position, so the columns describe CAPACITY rather than
   * performance. The avatar is intentionally muted (surface, not brand gradient)
   * so a glance at the drawer never confuses the two tables.
   */
  const symbolNonHolderColumns: Column<SymbolNonHolderRow>[] = [
    { key: 'srNo', header: 'Sr No', accessor: (r) => r.srNo, align: 'center', width: '64px' },
    {
      key: 'clientName',
      header: 'Client',
      accessor: (r) => r.clientName,
      render: (r) => (
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-3 text-2xs font-semibold text-ink-secondary">
            {r.clientName.slice(0, 2).toUpperCase()}
          </span>
          <span className="font-semibold text-ink">{r.clientName}</span>
        </div>
      ),
    },
    {
      key: 'bookValue',
      header: 'Book Value',
      accessor: (r) => r.bookValue,
      align: 'right',
      render: (r) =>
        r.bookValue > 0 ? (
          formatCurrency(r.bookValue, currency)
        ) : (
          // A genuinely empty book is a real state worth naming, not a $0 cell.
          <span className="text-ink-tertiary">No holdings</span>
        ),
    },
    {
      key: 'cashBalance',
      header: 'Available Cash',
      accessor: (r) => r.cashBalance,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.cashBalance > 0 ? 'text-ink' : 'text-ink-tertiary')}>
          {formatCurrency(r.cashBalance, currency)}
        </span>
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
    { key: 'marketValue', header: 'Market Value', accessor: (r) => r.marketValue, align: 'right', render: (r) => <span className="font-semibold">{formatCurrency(r.marketValue, currency)}</span> },
    {
      key: 'pnl',
      header: 'P&L',
      accessor: (r) => r.pnl,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.pnl >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.pnl, currency)}
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
    { key: 'averageCost', header: 'Avg Cost', accessor: (r) => r.averageCost, align: 'right', render: (r) => formatCurrency(r.averageCost, currency) },
    { key: 'currentPrice', header: 'Price', accessor: (r) => r.currentPrice, align: 'right', render: (r) => formatCurrency(r.currentPrice, currency) },
    { key: 'marketValue', header: 'Market Value', accessor: (r) => r.marketValue, align: 'right', render: (r) => <span className="font-semibold">{formatCurrency(r.marketValue, currency)}</span> },
    {
      key: 'unrealizedPnL',
      header: 'P&L',
      accessor: (r) => r.unrealizedPnL,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold', r.unrealizedPnL >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedCurrency(r.unrealizedPnL, currency)}
        </span>
      ),
    },
  ];

  usePageHeading(
    {
      title: "Holdings & Allocations",
      subtitle: "Consolidated positions across every managed account",
      actions: (
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
      ),
    }
  );

  return (
    <>
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <SummaryTile icon={<Wallet className="h-4 w-4" />} label="Total Market Value" value={formatCompactCurrency(totalMv, currency)} />
          <SummaryTile
            icon={<PiggyBank className="h-4 w-4" />}
            label="Deployable Cash"
            value={formatCompactCurrency(totalCash, currency)}
            hint={totalMv + totalCash > 0 ? `${formatPct((totalCash / (totalMv + totalCash)) * 100)} of assets` : undefined}
          />
          <SummaryTile
            icon={<TrendingUp className="h-4 w-4" />}
            label="Unrealized P&L"
            value={formatSignedCurrency(totalPnl, currency)}
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
            onRowClick={(r) => setActiveSymbol(r)}
            onExport={(rows) => {
              exportToCsv('holdings-by-symbol.csv', symbolColumns, rows);
              toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
            }}
            emptyTitle="No symbols yet"
            emptyDescription="Add your first position to populate holdings."
          />
        )}

        {view === 'clients' && (
          <div className="space-y-6">
            {/*
              Households come first, above the individual mandates they group.
              A family is the level the desk reviews at when one exists, and the
              members remain listed below — the family view is an addition to
              the account list, never a replacement for it.
            */}
            {familyRows.length > 0 && (
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4 text-ink-secondary" />
                  <h3 className="text-[13px] font-semibold text-ink">Families</h3>
                  <span className="text-2xs text-ink-tertiary">
                    Combined household positions, duplicates merged
                  </span>
                </div>
                <DataTable
                  columns={familyColumns}
                  data={familyRows}
                  loading={loading}
                  rowKey={(r) => r.familyId}
                  searchPlaceholder="Search families…"
                  onRowClick={(r) => setActiveFamily(r)}
                  onExport={(rows) => {
                    exportToCsv('holdings-by-family.csv', familyColumns, rows);
                    toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
                  }}
                />
              </div>
            )}

            <div>
              {familyRows.length > 0 && (
                <div className="mb-3 flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-ink-secondary" />
                  <h3 className="text-[13px] font-semibold text-ink">Individual Accounts</h3>
                </div>
              )}
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
            </div>
          </div>
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

      {/* Family drill-down — the integrated household view */}
      <Drawer
        isOpen={!!activeFamily}
        onClose={() => setActiveFamily(null)}
        title={activeFamily ? `${activeFamily.familyName} — Family Portfolio` : ''}
        description={
          activeFamily
            ? `${activeFamily.accounts} account${activeFamily.accounts === 1 ? '' : 's'} combined · ` +
              `${activeFamily.positions} unique position${activeFamily.positions === 1 ? '' : 's'} · ` +
              `${formatCurrency(activeFamily.portfolioValue, currency)} total`
            : ''
        }
        width={1180}
        maximizable
      >
        {activeFamily && (
          <div className="space-y-5">
            {familyLoading && (
              <p className="py-8 text-center text-[13px] text-ink-tertiary">
                Merging the household&apos;s positions…
              </p>
            )}

            {!familyLoading && !familyAggregate && (
              <p className="py-8 text-center text-[13px] text-ink-tertiary">
                This family&apos;s combined portfolio could not be loaded.
              </p>
            )}

            {!familyLoading && familyAggregate && (
              <>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                  <SummaryTile
                    icon={<Wallet className="h-4 w-4" />}
                    label="Cost Basis"
                    value={formatCurrency(familyAggregate.totals.costBasis, currency)}
                  />
                  <SummaryTile
                    icon={<TrendingUp className="h-4 w-4" />}
                    label="Market Value"
                    value={formatCurrency(familyAggregate.totals.marketValue, currency)}
                    hint={`${formatCurrency(familyAggregate.totals.portfolioValue, currency)} incl. cash`}
                  />
                  <SummaryTile
                    icon={<PiggyBank className="h-4 w-4" />}
                    label="Cash"
                    value={formatCurrency(familyAggregate.totals.cashBalance, currency)}
                    hint="Across every member account"
                  />
                  <SummaryTile
                    icon={<Briefcase className="h-4 w-4" />}
                    label="Unrealized P&L"
                    value={formatSignedCurrency(familyAggregate.totals.unrealizedPnL, currency)}
                    hint={formatSignedPct(familyAggregate.totals.unrealizedPnLPercent)}
                    tone={familyAggregate.totals.unrealizedPnL >= 0 ? 'success' : 'danger'}
                  />
                  <SummaryTile
                    icon={<Layers className="h-4 w-4" />}
                    label="Unique Positions"
                    value={String(familyAggregate.totals.positionCount)}
                    // The gap between the two is the point of the merge: 18 lots
                    // across the accounts may be only 11 distinct names.
                    hint={`from ${familyAggregate.totals.lotCount} account lot${
                      familyAggregate.totals.lotCount === 1 ? '' : 's'
                    }`}
                  />
                </div>

                {/* Member accounts making up the household */}
                <Card padding="md">
                  <p className="mb-3 text-[13px] font-semibold text-ink">Member Accounts</p>
                  <div className="flex flex-wrap gap-2">
                    {familyAggregate.members.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-2xs"
                      >
                        <span className="font-medium text-ink">{m.name}</span>
                        <span className="tabular-nums text-ink-tertiary">
                          {formatCurrency(m.portfolioValue, currency)}
                        </span>
                      </span>
                    ))}
                  </div>
                </Card>

                {/* Combined sector allocation */}
                {familyAggregate.sectorAllocation.length > 0 && (
                  <Card padding="md">
                    <p className="mb-3 text-[13px] font-semibold text-ink">
                      Sector Allocation
                      <span className="ml-2 text-2xs font-normal text-ink-tertiary">
                        across the combined household portfolio
                      </span>
                    </p>
                    <div className="space-y-2.5">
                      {familyAggregate.sectorAllocation.map((s) => (
                        <div key={s.sector} className="flex items-center gap-3">
                          <span className="w-40 shrink-0 truncate text-2xs text-ink-secondary">
                            {s.sector}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className="h-full rounded-full bg-brand"
                              style={{ width: `${Math.min(100, s.weight)}%` }}
                            />
                          </div>
                          <span className="w-16 shrink-0 text-right text-2xs tabular-nums text-ink-secondary">
                            {formatPct(s.weight)}
                          </span>
                          <span className="w-28 shrink-0 text-right text-2xs tabular-nums text-ink-tertiary">
                            {formatCompactCurrency(s.marketValue, currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Merged positions */}
                <DataTable
                  columns={familyPositionColumns}
                  data={familyAggregate.positions}
                  rowKey={(r) => r.ticker}
                  searchPlaceholder="Search the family's positions…"
                  emptyTitle="No open positions"
                  emptyDescription="No member of this family holds an open position yet."
                  onExport={(rows) => {
                    void handleExportFamily(rows);
                  }}
                />
              </>
            )}
          </div>
        )}
      </Drawer>

      {/* Client drill-down */}
      <Drawer
        isOpen={!!activeClient}
        onClose={() => setActiveClient(null)}
        title={activeClient ? `${activeClient.clientName} — Holdings` : ''}
        description={
          activeClient
            ? `${clientPositions.length} position${clientPositions.length === 1 ? '' : 's'} · ${formatCurrency(
                clientTotals.currentValue
              , currency)} invested · ${formatCurrency(activeClient.cashBalance, currency)} cash (${formatPct(
                activeClient.cashWeight
              )} of portfolio)`
            : ''
        }
        width={1180}
        maximizable
      >
        {activeClient && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <SummaryTile icon={<Wallet className="h-4 w-4" />} label="Cost Basis" value={formatCurrency(clientTotals.costBasisTotal, currency)} />
              <SummaryTile
                icon={<Briefcase className="h-4 w-4" />}
                label="Current Value"
                value={formatCurrency(clientTotals.currentValue, currency)}
                hint={
                  activeClient.cashBalance > 0
                    ? `${formatCurrency(clientTotals.currentValue + activeClient.cashBalance, currency)} incl. cash`
                    : undefined
                }
              />
              <SummaryTile
                icon={<PiggyBank className="h-4 w-4" />}
                label="Cash Available"
                value={formatCurrency(activeClient.cashBalance, currency)}
                hint={`${formatPct(activeClient.cashWeight)} of portfolio · deploy or hold`}
              />
              <SummaryTile
                icon={<TrendingUp className="h-4 w-4" />}
                label="Unrealized P&L"
                value={formatSignedCurrency(clientTotals.pl, currency)}
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

            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <label htmlFor="historical-date" className="block text-sm font-medium text-ink-secondary mb-2">
                  Export holdings as of date
                </label>
                <div className="flex gap-2">
                  <input
                    id="historical-date"
                    type="date"
                    value={historicalDate}
                    onChange={(e) => setHistoricalDate(e.target.value)}
                    max={new Date().toISOString().split('T')[0]}
                    className="flex-1 px-3 py-2 rounded-[8px] border border-border bg-surface-2 text-sm text-ink placeholder-ink-tertiary focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <Button
                    variant="secondary"
                    leftIcon={<Download className="h-4 w-4" />}
                    onClick={handleExportHistoricalHoldings}
                    disabled={!historicalDate || loadingHistorical}
                    loading={loadingHistorical}
                  >
                    Export Historical
                  </Button>
                </div>
              </div>
            </div>

            <DataTable
              columns={clientPositionColumns}
              data={clientPositions}
              rowKey={(r) => r.id}
              pageSize={20}
              searchPlaceholder="Search symbols or names…"
              onExport={(rows) => {
                downloadClientHoldingsWorkbook(activeClient.clientName, rows, activeClient.cashBalance)
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
              <ConfirmField label="Average Cost" value={formatCurrency(pendingDelete.averageCostBasis, currency)} />
              <ConfirmField label="Current Value" value={formatCurrency(pendingDelete.currentValue, currency)} />
              <ConfirmField
                label="Unrealized P&L"
                value={formatSignedCurrency(pendingDelete.pl, currency)}
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
              , currency)} current value · ${formatPct(activeSector.weight)} of book`
            : ''
        }
        width={1180}
        maximizable
      >
        {activeSector && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <SummaryTile icon={<Wallet className="h-4 w-4" />} label="Cost Basis" value={formatCurrency(sectorTotals.costBasisTotal, currency)} />
              <SummaryTile icon={<Briefcase className="h-4 w-4" />} label="Current Value" value={formatCurrency(sectorTotals.currentValue, currency)} />
              <SummaryTile
                icon={<TrendingUp className="h-4 w-4" />}
                label="Unrealized P&L"
                value={formatSignedCurrency(sectorTotals.pl, currency)}
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

      {/* Symbol drill-down — which clients hold this name, and at what weight */}
      <Drawer
        isOpen={!!activeSymbol}
        onClose={() => setActiveSymbol(null)}
        title={activeSymbol ? `${activeSymbol.symbol} — Holders` : ''}
        description={
          activeSymbol
            ? `${activeSymbol.company} · ${symbolHolders.length} client${
                symbolHolders.length === 1 ? '' : 's'
              } · ${formatCurrency(symbolTotals.currentValue, currency)} current value` +
              (symbolNonHolders.length ? ` · ${symbolNonHolders.length} not holding` : '')
            : ''
        }
        width={1180}
        maximizable
      >
        {activeSymbol && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <SummaryTile icon={<Wallet className="h-4 w-4" />} label="Cost Basis" value={formatCurrency(symbolTotals.costBasisTotal, currency)} />
              <SummaryTile icon={<Briefcase className="h-4 w-4" />} label="Current Value" value={formatCurrency(symbolTotals.currentValue, currency)} />
              <SummaryTile
                icon={<TrendingUp className="h-4 w-4" />}
                label="Unrealized P&L"
                value={formatSignedCurrency(symbolTotals.pl, currency)}
                tone={symbolTotals.pl >= 0 ? 'success' : 'danger'}
              />
              <SummaryTile
                icon={<Layers className="h-4 w-4" />}
                label="Return"
                value={formatSignedPct(
                  symbolTotals.costBasisTotal ? (symbolTotals.pl / symbolTotals.costBasisTotal) * 100 : 0
                )}
                tone={symbolTotals.pl >= 0 ? 'success' : 'danger'}
              />
            </div>

            <DataTable
              columns={symbolHolderColumns}
              data={symbolHolders}
              rowKey={(r) => r.id}
              pageSize={20}
              searchPlaceholder="Search clients…"
              onExport={(rows) => {
                exportToCsv(`${activeSymbol.symbol}-holders.csv`, symbolHolderColumns, rows);
                toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
              }}
              emptyTitle="No holders"
              emptyDescription="No client holds this symbol."
            />

            {/* The complement — who is still to be deployed into this name. */}
            <div className="border-t border-line pt-5">
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-ink">
                    Not held by
                    <span className="ml-2 text-ink-tertiary">
                      {symbolNonHolders.length} client{symbolNonHolders.length === 1 ? '' : 's'}
                    </span>
                  </h3>
                  <p className="mt-0.5 text-xs text-ink-tertiary">
                    Clients with no position in {activeSymbol.symbol} — the deployment shortlist,
                    ordered by available cash.
                  </p>
                </div>
                {nonHolderCash > 0 && (
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-ink-tertiary">Undeployed cash</p>
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {formatCurrency(nonHolderCash, currency)}
                    </p>
                  </div>
                )}
              </div>

              <DataTable
                columns={symbolNonHolderColumns}
                data={symbolNonHolders}
                rowKey={(r) => r.id}
                pageSize={10}
                searchPlaceholder="Search clients…"
                onExport={(rows) => {
                  exportToCsv(
                    `${activeSymbol.symbol}-not-held.csv`,
                    symbolNonHolderColumns,
                    rows
                  );
                  toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
                }}
                emptyTitle={allClients.length ? 'Held by every client' : 'Client list unavailable'}
                emptyDescription={
                  allClients.length
                    ? `Every client on the book already holds ${activeSymbol.symbol}.`
                    : 'The client roster could not be loaded, so non-holders cannot be listed. Reload the page to try again.'
                }
              />
            </div>
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
    </>
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
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: 'success' | 'danger';
  /** Optional secondary line, e.g. a share-of-assets figure under the value. */
  hint?: string;
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
          {hint && <p className="text-2xs text-ink-tertiary">{hint}</p>}
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
