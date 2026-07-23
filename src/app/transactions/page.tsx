'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, ArrowDownLeft, ArrowUpRight, Coins, Plus, Wallet, Layers, List } from 'lucide-react';
import { clientsApi } from '@/lib/clients.api';
import { transactionsApi } from '@/lib/transactions.api';
import { formatCurrency, formatCompactCurrency, cn } from '@/lib/utils';
import { Transaction, Client, TransactionType } from '@/types';
import AppShell from '@/components/layout/AppShell';
import { CashFlowModal } from '@/components/transactions/CashFlowModal';
import { DividendModal } from '@/components/transactions/DividendModal';
import { GroupedByDate } from '@/components/transactions/GroupedByDate';
import {
  Card,
  Tabs,
  Badge,
  Button,
  DataTable,
  exportToCsv,
  useToast,
  type Column,
} from '@/components/ui';

interface TxRow extends Transaction {
  client?: Client;
}

const txMeta: Record<string, { tone: any; label: string }> = {
  buy: { tone: 'success', label: 'Buy' },
  sell: { tone: 'danger', label: 'Sell' },
  dividend: { tone: 'brand', label: 'Dividend' },
  split: { tone: 'info', label: 'Split' },
  bonus: { tone: 'info', label: 'Bonus' },
  transfer: { tone: 'neutral', label: 'Transfer' },
  cash_deposit: { tone: 'info', label: 'Deposit' },
  cash_withdrawal: { tone: 'warning', label: 'Withdrawal' },
  fees: { tone: 'warning', label: 'Fees' },
};

type View = 'all' | 'trades' | 'income' | 'flows';

export default function TransactionsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [txns, setTxns] = useState<TxRow[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('all');
  const [grouped, setGrouped] = useState(false);
  const [flowModalOpen, setFlowModalOpen] = useState(false);
  const [dividendModalOpen, setDividendModalOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Both go through the api modules rather than raw axios: /clients returns a
        // paginated envelope, not a bare array, and clientsApi.list() is the one place
        // that unwraps it. Reading `res.data` here directly hands back {data, total,
        // page} — which type-asserts to Client[] happily and then explodes on .filter.
        const [txList, clientList] = await Promise.all([
          transactionsApi.list(),
          clientsApi.list(),
        ]);

        setClients(clientList);
        setTxns(
          txList.map((tx) => ({
            ...tx,
            client: clientList.find((cl) => cl.id === tx.clientId),
          }))
        );
      } catch {
        toast({ tone: 'error', title: 'Failed to load transactions' });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tradeTypes: TransactionType[] = ['buy', 'sell', 'split', 'bonus', 'transfer'];
  const incomeTypes: TransactionType[] = ['dividend', 'fees'];

  /**
   * The rows that actually drive each client's XIRR — which depends on that
   * client's accounting method, not on the transaction type alone. This mirrors
   * `buildFlows` on the backend; if the two ever disagree, this tab is lying about
   * what the return is computed from.
   *
   *   transactional client -> its BUYs and SELLs are the flows
   *   cash-flow client     -> its DEPOSITs and WITHDRAWALs are the flows
   *
   * A deposit on a transactional client is deliberately NOT here: the engine never
   * reads it, so showing it would imply it counts toward that client's return.
   */
  const isFlowRow = (t: TxRow) => {
    const method = t.client?.accountingMethod;
    if (method === 'transactional') return t.type === 'buy' || t.type === 'sell';
    if (method === 'cash_flow')
      return t.type === 'cash_deposit' || t.type === 'cash_withdrawal';
    return false; // unknown client — do not guess which side it falls on
  };

  /** Money into the portfolio: a deposit, or a buy that deployed capital. */
  const isInflowRow = (t: TxRow) => t.type === 'cash_deposit' || t.type === 'buy';

  const cashFlowRows = useMemo(
    () => txns.filter(isFlowRow),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txns]
  );

  const incomeRows = useMemo(
    () => txns.filter((t) => incomeTypes.includes(t.type)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txns]
  );

  const tradeRows = useMemo(
    () => txns.filter((t) => tradeTypes.includes(t.type)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [txns]
  );

  const filtered = useMemo(() => {
    if (view === 'trades') return tradeRows;
    if (view === 'income') return incomeRows;
    if (view === 'flows') return cashFlowRows;
    return txns;
  }, [txns, view, tradeRows, incomeRows, cashFlowRows]);

  const buys = txns.filter((t) => t.type === 'buy').reduce((s, t) => s + t.amount, 0);
  const sells = txns.filter((t) => t.type === 'sell').reduce((s, t) => s + t.amount, 0);
  const dividends = txns
    .filter((t) => t.type === 'dividend')
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  // Flow-tab summary: capital in vs out, across whichever rows drive each client.
  const inflows = cashFlowRows
    .filter(isInflowRow)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const outflows = cashFlowRows
    .filter((t) => !isInflowRow(t))
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const columns: Column<TxRow>[] = [
    {
      key: 'type',
      header: 'Type',
      accessor: (r) => r.type,
      render: (r) => {
        const meta = txMeta[r.type] ?? { tone: 'neutral', label: r.type };
        return (
          <Badge tone={meta.tone} dot>
            {meta.label}
          </Badge>
        );
      },
    },
    {
      key: 'ticker',
      header: 'Instrument',
      accessor: (r) => r.ticker ?? '',
      render: (r) => <span className="font-semibold text-ink">{r.ticker ?? '—'}</span>,
    },
    {
      key: 'client',
      header: 'Client',
      accessor: (r) => r.client?.name ?? '',
      render: (r) => r.client?.name ?? '—',
    },
    {
      key: 'quantity',
      header: 'Quantity',
      accessor: (r) => r.quantity ?? 0,
      align: 'right',
      render: (r) => (r.quantity ? r.quantity.toLocaleString() : '—'),
    },
    {
      key: 'price',
      header: 'Price',
      accessor: (r) => r.price ?? 0,
      align: 'right',
      render: (r) => (r.price ? formatCurrency(r.price) : '—'),
    },
    {
      key: 'amount',
      header: 'Amount',
      accessor: (r) => r.amount,
      align: 'right',
      render: (r) => <span className="font-semibold tabular-nums">{formatCurrency(r.amount)}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      accessor: (r) => new Date(r.date).getTime(),
      align: 'right',
      render: (r) =>
        new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
  ];

  /**
   * The flows tab answers "what money moved, which way" — so it leads with the
   * direction and shows the method that made the row a flow at all. Price and
   * quantity are dropped: they are meaningless for a deposit.
   */
  const flowColumns: Column<TxRow>[] = [
    {
      key: 'direction',
      header: 'Direction',
      accessor: (r) => (isInflowRow(r) ? 'Inflow' : 'Outflow'),
      render: (r) => {
        const inflow = isInflowRow(r);
        return (
          <span
            className={cn(
              'inline-flex items-center gap-1.5 text-[13px] font-semibold',
              inflow ? 'text-success' : 'text-danger'
            )}
          >
            {inflow ? (
              <ArrowDownLeft className="h-3.5 w-3.5" />
            ) : (
              <ArrowUpRight className="h-3.5 w-3.5" />
            )}
            {inflow ? 'Inflow' : 'Outflow'}
          </span>
        );
      },
    },
    {
      key: 'client',
      header: 'Client',
      accessor: (r) => r.client?.name ?? '',
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-ink">{r.client?.name ?? '—'}</p>
          <p className="text-xs text-ink-tertiary">
            {r.client?.accountingMethod === 'transactional'
              ? 'Transaction based'
              : 'Cash flow based'}
          </p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Source',
      accessor: (r) => r.type,
      render: (r) => {
        const meta = txMeta[r.type] ?? { tone: 'neutral', label: r.type };
        return <Badge tone={meta.tone}>{meta.label}</Badge>;
      },
    },
    {
      key: 'ticker',
      header: 'Instrument',
      accessor: (r) => r.ticker ?? '',
      render: (r) => <span className="font-medium text-ink">{r.ticker ?? '—'}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      accessor: (r) => r.amount,
      align: 'right',
      render: (r) => (
        <span
          className={cn(
            'font-semibold tabular-nums',
            isInflowRow(r) ? 'text-success' : 'text-danger'
          )}
        >
          {isInflowRow(r) ? '+' : '−'}
          {formatCurrency(Math.abs(r.amount))}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      accessor: (r) => new Date(r.date).getTime(),
      align: 'right',
      render: (r) =>
        new Date(r.date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
    },
  ];

  return (
    <AppShell
      title="Transactions"
      subtitle="Trade and cash activity across every managed account"
      actions={
        <>
          <Button
            variant="outline"
            leftIcon={<Coins className="h-4 w-4" />}
            onClick={() => setDividendModalOpen(true)}
          >
            Dividend
          </Button>
          <Button
            variant="outline"
            leftIcon={<Wallet className="h-4 w-4" />}
            onClick={() => setFlowModalOpen(true)}
          >
            Set Cash
          </Button>
          <Button
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => router.push('/symbols/add')}
          >
            Trade
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Summary — the flows tab answers a different question, so it gets its own row. */}
        {view === 'flows' ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryTile icon={<Wallet className="h-4 w-4" />} label="Flow Entries" value={String(cashFlowRows.length)} />
            <SummaryTile icon={<ArrowDownLeft className="h-4 w-4" />} label="Total Inflows" value={formatCompactCurrency(inflows)} tone="success" />
            <SummaryTile icon={<ArrowUpRight className="h-4 w-4" />} label="Total Outflows" value={formatCompactCurrency(outflows)} tone="danger" />
            <SummaryTile icon={<ArrowLeftRight className="h-4 w-4" />} label="Net Capital In" value={formatCompactCurrency(inflows - outflows)} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SummaryTile icon={<ArrowLeftRight className="h-4 w-4" />} label="Total Transactions" value={String(txns.length)} />
            <SummaryTile icon={<ArrowUpRight className="h-4 w-4" />} label="Buys" value={formatCompactCurrency(buys)} tone="success" />
            <SummaryTile icon={<ArrowDownLeft className="h-4 w-4" />} label="Sells" value={formatCompactCurrency(sells)} tone="danger" />
            <SummaryTile icon={<Coins className="h-4 w-4" />} label="Dividends" value={formatCompactCurrency(dividends)} />
          </div>
        )}

        {/* Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            tabs={[
              { value: 'all', label: 'All', count: txns.length },
              { value: 'trades', label: 'Trades', count: tradeRows.length },
              { value: 'income', label: 'Income', count: incomeRows.length },
              { value: 'flows', label: 'Cash Flows', count: cashFlowRows.length },
            ]}
            value={view}
            onChange={(v) => setView(v as View)}
          />

          {view !== 'flows' && (
            <Button
              variant="outline"
              size="sm"
              leftIcon={grouped ? <List className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
              onClick={() => setGrouped((v) => !v)}
            >
              {grouped ? 'Show all rows' : 'Group by date'}
            </Button>
          )}
        </div>

        {grouped && view !== 'flows' && (
          <p className="-mt-2 text-[13px] leading-relaxed text-ink-secondary">
            One row per deployment date — the total cash moved across every instrument bought or
            sold that day. Expand a date to see the individual entries; each one still counts on
            its own toward the client's XIRR.
          </p>
        )}

        {view === 'flows' && (
          <p className="-mt-2 text-[13px] leading-relaxed text-ink-secondary">
            The entries that drive each client’s XIRR, according to their method.{' '}
            <span className="font-medium text-ink">Transaction-based</span> clients show
            their buys (money in) and sells (money out).{' '}
            <span className="font-medium text-ink">Cash-flow-based</span> clients show the
            inflows and outflows they actually gave you.
          </p>
        )}

        {view === 'income' && (
          <p className="-mt-2 text-[13px] leading-relaxed text-ink-secondary">
            Dividends received and fees paid. Dividends raise the client’s return under both
            methods — directly as a flow for transaction-based clients, and through the cash
            balance for cash-flow-based ones.
          </p>
        )}

        {grouped && view !== 'flows' ? (
          <GroupedByDate rows={filtered} columns={columns} rowKey={(r) => r.id} />
        ) : (
          <DataTable
            columns={view === 'flows' ? flowColumns : columns}
            data={filtered}
            loading={loading}
            rowKey={(r) => r.id}
            searchPlaceholder="Search by instrument or client…"
            searchKeys={(r) => `${r.ticker ?? ''} ${r.client?.name ?? ''} ${r.type}`}
            onExport={(rows) => {
              // Export what is on screen — the flows view has its own column set.
              exportToCsv(
                view === 'flows' ? 'cash-flows.csv' : 'transactions.csv',
                view === 'flows' ? flowColumns : columns,
                rows
              );
              toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
            }}
            emptyTitle={
              view === 'flows'
                ? 'No cash flows yet'
                : view === 'income'
                  ? 'No income recorded'
                  : 'No transactions yet'
            }
            emptyDescription={
              view === 'flows'
                ? 'Nothing here yet. Cash-flow clients need their inflows recorded; transaction-based clients need at least one buy. XIRR cannot be calculated without either.'
                : view === 'income'
                  ? 'Dividends received and fees paid will appear here.'
                  : 'Recorded trades and cash activity will appear here.'
            }
          />
        )}
      </div>

      <CashFlowModal
        isOpen={flowModalOpen}
        onClose={() => setFlowModalOpen(false)}
        clients={clients}
        onSaved={(updated) => {
          // Cash is a client property, not a transaction — patch the client in
          // state so the flow-tab's per-client method label and any cash figure
          // reflect the new balance without a full reload.
          setClients((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
          setTxns((prev) =>
            prev.map((t) => (t.clientId === updated.id ? { ...t, client: updated } : t))
          );
        }}
      />

      <DividendModal
        isOpen={dividendModalOpen}
        onClose={() => setDividendModalOpen(false)}
        clients={clients}
        onRecorded={(tx) => {
          setTxns((prev) => [
            { ...tx, client: clients.find((c) => c.id === tx.clientId) },
            ...prev,
          ]);
          setView('income');
        }}
      />
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
