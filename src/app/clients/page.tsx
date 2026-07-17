'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Wallet, TrendingUp, PiggyBank, Plus, Trash2 } from 'lucide-react';
import { clientsApi } from '@/lib/clients.api';
import {
  formatCurrency,
  formatCompactCurrency,
  formatSignedPct,
  cn,
} from '@/lib/utils';
import { Client, RiskProfile, ClientStatus } from '@/types';
import AppShell from '@/components/layout/AppShell';
import {
  Card,
  Badge,
  Button,
  DataTable,
  exportToCsv,
  useToast,
  type Column,
} from '@/components/ui';

const riskMeta: Record<RiskProfile, { tone: any; label: string }> = {
  conservative: { tone: 'info', label: 'Conservative' },
  moderate: { tone: 'neutral', label: 'Moderate' },
  aggressive: { tone: 'warning', label: 'Aggressive' },
};

const statusMeta: Record<ClientStatus, { tone: any; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  inactive: { tone: 'neutral', label: 'Inactive' },
  closed: { tone: 'danger', label: 'Closed' },
};

export default function ClientsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setClients(await clientsApi.list({ limit: 100 }));
      } catch {
        toast({ tone: 'error', title: 'Failed to load clients' });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalAum = clients.reduce((s, c) => s + c.portfolioValue, 0);
  const totalCash = clients.reduce((s, c) => s + c.cashBalance, 0);
  const avgXirr = clients.length
    ? clients.reduce((s, c) => s + c.xirr, 0) / clients.length
    : 0;

  const handleDelete = async (client: Client) => {
    const snapshot = clients;
    setClients((prev) => prev.filter((c) => c.id !== client.id));
    try {
      await clientsApi.remove(client.id);
      toast({ tone: 'success', title: `${client.name} removed` });
    } catch {
      setClients(snapshot); // roll back the optimistic removal
      toast({ tone: 'error', title: 'Failed to remove client' });
    }
  };

  const columns: Column<Client>[] = [
    {
      key: 'name',
      header: 'Client',
      accessor: (r) => r.name,
      render: (r) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-active text-2xs font-semibold text-white">
            {r.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink">{r.name}</p>
            <p className="max-w-[200px] truncate text-xs text-ink-tertiary">{r.broker}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'accountNumber',
      header: 'Account',
      accessor: (r) => r.accountNumber,
      render: (r) => <span className="tabular-nums text-ink-secondary">{r.accountNumber}</span>,
    },
    {
      key: 'benchmark',
      header: 'Benchmark',
      accessor: (r) => r.benchmark,
      defaultHidden: true,
    },
    {
      key: 'riskProfile',
      header: 'Risk',
      accessor: (r) => r.riskProfile,
      render: (r) => <Badge tone={riskMeta[r.riskProfile].tone}>{riskMeta[r.riskProfile].label}</Badge>,
    },
    {
      key: 'portfolioValue',
      header: 'Portfolio Value',
      accessor: (r) => r.portfolioValue,
      align: 'right',
      render: (r) => <span className="font-semibold">{formatCurrency(r.portfolioValue)}</span>,
    },
    {
      key: 'cashBalance',
      header: 'Cash',
      accessor: (r) => r.cashBalance,
      align: 'right',
      render: (r) => formatCurrency(r.cashBalance),
    },
    {
      key: 'xirr',
      header: 'XIRR',
      accessor: (r) => r.xirr,
      align: 'right',
      render: (r) => (
        <span className={cn('font-semibold tabular-nums', r.xirr >= 0 ? 'text-success' : 'text-danger')}>
          {formatSignedPct(r.xirr)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => r.status,
      render: (r) => (
        <Badge tone={statusMeta[r.status].tone} dot>
          {statusMeta[r.status].label}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      accessor: () => '',
      align: 'right',
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={(e) => {
            e.stopPropagation();
            handleDelete(r);
          }}
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <AppShell
      title="Clients"
      subtitle="Mandates and accounts under management"
      actions={
        <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => router.push('/clients/add')}>
          Add Client
        </Button>
      }
    >
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryTile icon={<Users className="h-4 w-4" />} label="Total Clients" value={String(clients.length)} />
          <SummaryTile icon={<Wallet className="h-4 w-4" />} label="Total AUM" value={formatCompactCurrency(totalAum)} />
          <SummaryTile icon={<PiggyBank className="h-4 w-4" />} label="Total Cash" value={formatCompactCurrency(totalCash)} />
          <SummaryTile
            icon={<TrendingUp className="h-4 w-4" />}
            label="Average XIRR"
            value={`${avgXirr.toFixed(1)}%`}
            tone={avgXirr >= 0 ? 'success' : 'danger'}
          />
        </div>

        <DataTable
          columns={columns}
          data={clients}
          loading={loading}
          rowKey={(r) => r.id}
          searchPlaceholder="Search clients, brokers, or accounts…"
          searchKeys={(r) => `${r.name} ${r.broker} ${r.accountNumber} ${r.benchmark}`}
          onExport={(rows) => {
            exportToCsv('clients.csv', columns, rows);
            toast({ tone: 'success', title: 'Exported', description: `${rows.length} rows downloaded` });
          }}
          emptyTitle="No clients yet"
          emptyDescription="Onboard your first mandate to get started."
        />
      </div>
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
