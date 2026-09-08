'use client';

/**
 * The Corporate Action Review Center — PART 8, 39, 40 and 47.
 *
 * ── What this screen is for ─────────────────────────────────────────────────
 *
 * It is a DATA-QUALITY gate, not a permissions gate. A corporate action is a
 * fact about a security: if Amphenol split 2-for-1, every client holding
 * Amphenol is affected and no manager opts their book out. What a reviewer
 * confirms here is that the RECORD is right — the ratio parsed correctly, the
 * source is real, the dates are coherent — before it touches anyone's
 * holdings.
 *
 * That is why the preview (PART 39) leads with a portfolio-value impact of $0
 * for a split. The number is not decoration: it is the reviewer's proof that
 * the action preserves economic value, and a non-zero figure there is the
 * signal to stop and look.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Users,
} from 'lucide-react';
import {
  ACTION_LABEL,
  confidenceLabel,
  corporateActionsApi,
  isActionable,
  REVIEW_STATUSES,
  SOURCE_TIER_LABEL,
  type CorporateAction,
  type CorporateActionDetail,
  type CorporateActionPreview,
  type CorporateActionStatus,
  type CorporateActionSummary,
} from '@/lib/corporate-actions.api';
import { formatCurrency, formatDate, formatNumber, cn } from '@/lib/utils';
import { displayTicker } from '@/lib/market-scope';
import { useMarket } from '@/components/layout/MarketContext';
import { usePageHeading } from '@/components/layout/PageHeaderContext';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  Modal,
  Tabs,
  useToast,
  type Column,
  type TabItem,
} from '@/components/ui';
import { CorporateActionForm } from '@/components/corporate-actions/CorporateActionForm';
import { CorporateActionPreviewPanel } from '@/components/corporate-actions/CorporateActionPreviewPanel';

const STATUS_TONE: Record<
  CorporateActionStatus,
  'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info'
> = {
  DETECTED: 'neutral',
  PENDING_VALIDATION: 'neutral',
  VALIDATED: 'info',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'brand',
  PROCESSING: 'brand',
  PROCESSED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  FAILED: 'danger',
};

const STATUS_LABEL: Record<CorporateActionStatus, string> = {
  DETECTED: 'Detected',
  PENDING_VALIDATION: 'Pending Validation',
  VALIDATED: 'Validated',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  PROCESSING: 'Processing',
  PROCESSED: 'Processed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

type TabKey = 'review' | 'processed' | 'all';

export default function CorporateActionsPage() {
  usePageHeading({
    title: 'Corporate Actions',
    subtitle: 'Detect, validate and apply corporate actions across every book',
  });

  const { market } = useMarket();
  const { toast } = useToast();

  const [actions, setActions] = useState<CorporateAction[]>([]);
  const [summary, setSummary] = useState<CorporateActionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [tab, setTab] = useState<TabKey>('review');

  const [detail, setDetail] = useState<CorporateActionDetail | null>(null);
  const [preview, setPreview] = useState<CorporateActionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [rejecting, setRejecting] = useState<CorporateAction | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rows, counts] = await Promise.all([
        corporateActionsApi.list({ market, limit: 300 }),
        corporateActionsApi.summary(),
      ]);
      setActions(rows);
      setSummary(counts);
    } catch (error) {
      toast({ tone: 'error', title: 'Could not load corporate actions', description: message(error) });
    } finally {
      setLoading(false);
    }
  }, [market, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    if (tab === 'review') return actions.filter((a) => REVIEW_STATUSES.includes(a.status) || a.status === 'FAILED');
    if (tab === 'processed') return actions.filter((a) => a.status === 'PROCESSED');
    return actions;
  }, [actions, tab]);

  const openDetail = useCallback(
    async (action: CorporateAction) => {
      setPreview(null);
      setPreviewLoading(true);
      try {
        const full = await corporateActionsApi.detail(action.id);
        setDetail(full);

        // The preview is only meaningful for something not yet applied.
        if (isActionable(full.status)) {
          try {
            setPreview(await corporateActionsApi.preview(action.id));
          } catch (error) {
            // A preview can legitimately fail (an unusable ratio, say). The
            // drawer still opens so the reviewer can SEE why.
            toast({ tone: 'warning', title: 'Preview unavailable', description: message(error) });
          }
        }
      } catch (error) {
        toast({ tone: 'error', title: 'Could not open action', description: message(error) });
      } finally {
        setPreviewLoading(false);
      }
    },
    [toast],
  );

  const runSync = async () => {
    setSyncing(true);
    try {
      const result = await corporateActionsApi.sync();
      toast({
        tone: result.errors.length ? 'warning' : 'success',
        title: `${result.created} new, ${result.merged} merged`,
        description:
          `${result.pendingReview} awaiting review` +
          (result.conflicts ? `, ${result.conflicts} with source conflicts` : '') +
          (result.errors.length ? `. ${result.errors.length} provider issue(s).` : ''),
      });
      await load();
    } catch (error) {
      toast({ tone: 'error', title: 'Sync failed', description: message(error) });
    } finally {
      setSyncing(false);
    }
  };

  const act = async (
    action: CorporateAction,
    verb: 'validate' | 'approve' | 'process',
  ) => {
    setBusyId(action.id);
    try {
      if (verb === 'validate') {
        const outcome = await corporateActionsApi.validate(action.id);
        toast({
          tone: outcome.valid ? 'success' : 'error',
          title: outcome.valid ? 'Validation passed' : 'Validation failed',
          description: outcome.findings.map((f) => f.message).join(' ') || undefined,
        });
      } else if (verb === 'approve') {
        await corporateActionsApi.approve(action.id);
        toast({ tone: 'success', title: `${displayTicker(action.symbol)} approved` });
      } else {
        const result = await corporateActionsApi.process(action.id);
        toast({
          tone: result.reconciliation.status === 'RECONCILED' ? 'success' : 'warning',
          title: `Processed — ${result.clientsProcessed} client(s)`,
          description:
            `${formatNumber(result.totalSharesBefore)} → ${formatNumber(result.totalSharesAfter)} shares. ` +
            `${result.reconciliation.status}.`,
        });
      }
      await load();
      if (detail?.id === action.id) await openDetail(action);
    } catch (error) {
      toast({ tone: 'error', title: `Could not ${verb}`, description: message(error) });
    } finally {
      setBusyId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejecting || rejectReason.trim().length < 3) return;
    setBusyId(rejecting.id);
    try {
      await corporateActionsApi.reject(rejecting.id, rejectReason.trim());
      toast({ tone: 'success', title: `${displayTicker(rejecting.symbol)} rejected` });
      setRejecting(null);
      setRejectReason('');
      await load();
    } catch (error) {
      toast({ tone: 'error', title: 'Could not reject', description: message(error) });
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<CorporateAction>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      accessor: (r) => r.symbol,
      render: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{displayTicker(r.symbol)}</span>
            {r.hasConflict && (
              <Badge tone="danger" title="Sources disagree — cannot be processed automatically">
                <ShieldAlert className="h-3 w-3" /> Conflict
              </Badge>
            )}
          </div>
          <div className="truncate text-xs text-ink-tertiary">{r.company ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      accessor: (r) => ACTION_LABEL[r.actionType] ?? r.actionType,
      render: (r) => <span>{ACTION_LABEL[r.actionType] ?? r.actionType}</span>,
    },
    {
      key: 'ratio',
      header: 'Ratio',
      accessor: (r) => r.ratioLabel ?? (r.cashAmount != null ? String(r.cashAmount) : ''),
      render: (r) =>
        r.ratioLabel ? (
          <span className="font-mono">{r.ratioLabel}</span>
        ) : r.cashAmount != null ? (
          <span className="font-mono">{formatCurrency(r.cashAmount, r.currency ?? 'USD')}/sh</span>
        ) : r.newSymbol ? (
          <span className="inline-flex items-center gap-1 font-mono text-xs">
            {displayTicker(r.symbol)} <ArrowRight className="h-3 w-3" /> {displayTicker(r.newSymbol)}
          </span>
        ) : (
          <span className="text-ink-tertiary">—</span>
        ),
    },
    {
      key: 'announced',
      header: 'Announced',
      accessor: (r) => r.announcementDate ?? '',
      render: (r) => <span>{r.announcementDate ? formatDate(r.announcementDate) : '—'}</span>,
      defaultHidden: true,
    },
    {
      key: 'record',
      header: 'Record Date',
      accessor: (r) => r.recordDate ?? '',
      render: (r) => <span>{r.recordDate ? formatDate(r.recordDate) : '—'}</span>,
    },
    {
      key: 'ex',
      header: 'Ex Date',
      accessor: (r) => r.exDate ?? '',
      render: (r) => <span>{r.exDate ? formatDate(r.exDate) : '—'}</span>,
    },
    {
      key: 'effective',
      header: 'Effective',
      accessor: (r) => r.effectiveDate,
      render: (r) => <span className="font-medium">{formatDate(r.effectiveDate)}</span>,
    },
    {
      key: 'clients',
      header: 'Affected',
      align: 'right',
      accessor: (r) => r.affectedClients,
      render: (r) => (
        <div className="text-right">
          <div className="inline-flex items-center gap-1">
            <Users className="h-3 w-3 text-ink-tertiary" />
            {r.affectedClients}
          </div>
          <div className="text-xs text-ink-tertiary">{formatNumber(r.affectedShares)} sh</div>
        </div>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      accessor: (r) => r.source,
      render: (r) => {
        const tier = r.sources?.[0]?.tier;
        return (
          <div className="min-w-0">
            <div className="truncate">{tier ? SOURCE_TIER_LABEL[tier] : r.source}</div>
            {r.sources && r.sources.length > 1 && (
              <div className="text-xs text-ink-tertiary">+{r.sources.length - 1} more</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'confidence',
      header: 'Confidence',
      align: 'right',
      accessor: (r) => r.confidenceScore,
      render: (r) => {
        const { label, tone } = confidenceLabel(r.confidenceScore);
        return (
          <Badge tone={tone} title={`Confidence score ${r.confidenceScore}/100`}>
            {label}
          </Badge>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      accessor: (r) => r.status,
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status]} dot>
          {STATUS_LABEL[r.status]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      meta: true,
      accessor: () => '',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={() => void openDetail(r)}>
            View
          </Button>
        </div>
      ),
    },
  ];

  const tabs: TabItem[] = [
    {
      value: 'review',
      label: 'Needs Review',
      count: summary ? summary.pendingReview + summary.failed : undefined,
    },
    { value: 'processed', label: 'Processed', count: summary?.processed },
    { value: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as TabKey)} />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> Record Action
          </Button>
          <Button variant="secondary" onClick={() => void runSync()} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync Providers
          </Button>
        </div>
      </div>

      {summary && summary.failed > 0 && (
        <Card className="border-danger/30 bg-danger-soft/40">
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="text-sm">
              <div className="font-semibold text-danger">
                {summary.failed} action{summary.failed === 1 ? '' : 's'} failed to process
              </div>
              <p className="mt-1 text-ink-secondary">
                Every failed run was rolled back in full — no client was partially processed. Open
                the action to see the cause, then re-run it once the underlying data is corrected.
              </p>
            </div>
          </div>
        </Card>
      )}

      <DataTable
        columns={columns}
        data={visible}
        loading={loading}
        rowKey={(r) => r.id}
        searchPlaceholder="Search symbol or company…"
        searchKeys={(r) => `${r.symbol} ${r.company ?? ''} ${ACTION_LABEL[r.actionType] ?? ''}`}
        onRowClick={(r) => void openDetail(r)}
        emptyTitle={tab === 'review' ? 'Nothing awaiting review' : 'No corporate actions'}
        emptyDescription={
          tab === 'review'
            ? 'Detected actions that need a human decision will appear here.'
            : 'Run a provider sync or record an action from an IR announcement.'
        }
      />

      <Drawer
        isOpen={!!detail}
        onClose={() => {
          setDetail(null);
          setPreview(null);
        }}
        title={detail ? `${displayTicker(detail.symbol)} — ${ACTION_LABEL[detail.actionType]}` : ''}
        width={720}
      >
        {detail && (
          <CorporateActionPreviewPanel
            action={detail}
            preview={preview}
            previewLoading={previewLoading}
            busy={busyId === detail.id}
            onValidate={() => void act(detail, 'validate')}
            onApprove={() => void act(detail, 'approve')}
            onProcess={() => void act(detail, 'process')}
            onReject={() => setRejecting(detail)}
          />
        )}
      </Drawer>

      <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Record a corporate action">
        <CorporateActionForm
          onDone={async (created) => {
            setShowForm(false);
            await load();
            if (created) void openDetail(created);
          }}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      <Modal
        isOpen={!!rejecting}
        onClose={() => {
          setRejecting(null);
          setRejectReason('');
        }}
        title={rejecting ? `Reject ${displayTicker(rejecting.symbol)}?` : ''}
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary">
            A rejected action is kept on the record with its reason — it is never deleted. Say what
            is wrong with it, so the next person to see this symbol knows why it was set aside.
          </p>
          <textarea
            className="input min-h-24 w-full"
            placeholder="e.g. Ratio does not match the 8-K; FMP reported 3:1 but the filing says 2:1"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={rejectReason.trim().length < 3 || !!busyId}
              onClick={() => void confirmReject()}
            >
              <Ban className="h-4 w-4" /> Reject
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function message(error: unknown): string {
  const axiosLike = error as { response?: { data?: { message?: string | string[] } } };
  const detail = axiosLike?.response?.data?.message;
  if (Array.isArray(detail)) return detail.join(' ');
  if (typeof detail === 'string') return detail;
  return error instanceof Error ? error.message : 'Unexpected error';
}
