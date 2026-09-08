'use client';

/**
 * PART 39 (preview), PART 40 (client impact), PART 43 (audit) and PART 47
 * (mandatory data-quality fields) in one drawer.
 *
 * ── Why the value-impact figure is the headline ─────────────────────────────
 *
 * PART 39 asks the preview to show an estimated portfolio-value impact of $0
 * for a split, and that zero is the single most useful thing on this screen.
 * It is the reviewer's proof that the action preserves economic value — the
 * exact property PART 2 exists to protect. So it is rendered large, with an
 * explicit pass/fail read rather than as one number among many, and a non-zero
 * result on a ratio action is called out as something to investigate rather
 * than quietly displayed.
 */

import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  ExternalLink,
  Info,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  ACTION_LABEL,
  confidenceLabel,
  isActionable,
  SOURCE_TIER_LABEL,
  type CorporateActionDetail,
  type CorporateActionPreview,
} from '@/lib/corporate-actions.api';
import { formatCurrency, formatDate, formatNumber, cn } from '@/lib/utils';
import { displayTicker } from '@/lib/market-scope';
import { Badge, Button, Card } from '@/components/ui';

/** Ratio actions must show a zero value impact; cash actions legitimately do not. */
const RATIO_ACTIONS = new Set([
  'STOCK_SPLIT',
  'REVERSE_SPLIT',
  'BONUS_ISSUE',
  'STOCK_DIVIDEND',
  'TICKER_CHANGE',
  'NAME_CHANGE',
  'EXCHANGE_CHANGE',
]);

export function CorporateActionPreviewPanel({
  action,
  preview,
  previewLoading,
  busy,
  onValidate,
  onApprove,
  onProcess,
  onReject,
}: {
  action: CorporateActionDetail;
  preview: CorporateActionPreview | null;
  previewLoading: boolean;
  busy: boolean;
  onValidate: () => void;
  onApprove: () => void;
  onProcess: () => void;
  onReject: () => void;
}) {
  const errors = (action.validationErrors ?? []).filter((f) => f.severity === 'ERROR');
  const warnings = (action.validationErrors ?? []).filter((f) => f.severity === 'WARNING');
  const confidence = confidenceLabel(action.confidenceScore);

  const expectsZeroImpact = RATIO_ACTIONS.has(action.actionType);
  const impact = preview?.portfolioValueImpact ?? 0;
  // A tolerance rather than an exact zero: market value is quantity x a live
  // price, and float64 on a few thousand shares will not land on exactly 0.
  const impactIsClean = Math.abs(impact) < 0.01;

  return (
    <div className="space-y-5">
      {/* ── Data quality (PART 47) ─────────────────────────────────────────── */}
      <Card>
        <div className="grid grid-cols-2 gap-4 p-4 text-sm sm:grid-cols-3">
          <Field label="Source">
            <div className="flex items-center gap-1">
              {action.sources?.[0]?.tier
                ? SOURCE_TIER_LABEL[action.sources[0].tier]
                : action.source}
              {action.sourceUrl && (
                <a
                  href={action.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                  title="Open the source"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </Field>
          <Field label="Confidence">
            <Badge tone={confidence.tone}>
              {action.confidenceScore}/100 · {confidence.label}
            </Badge>
          </Field>
          <Field label="Validation">
            {action.validatedAt ? (
              errors.length ? (
                <Badge tone="danger">{errors.length} error(s)</Badge>
              ) : (
                <Badge tone="success">Passed</Badge>
              )
            ) : (
              <Badge tone="neutral">Not yet run</Badge>
            )}
          </Field>
          <Field label="Effective">{formatDate(action.effectiveDate)}</Field>
          <Field label="Record / Ex">
            {action.recordDate ? formatDate(action.recordDate) : '—'} /{' '}
            {action.exDate ? formatDate(action.exDate) : '—'}
          </Field>
          <Field label="Last updated">{formatDate(action.updatedAt)}</Field>
        </div>

        {action.sources && action.sources.length > 1 && (
          <div className="border-t border-line px-4 py-3 text-xs text-ink-secondary">
            <span className="font-medium">Corroborated by {action.sources.length} sources: </span>
            {action.sources.map((s, i) => (
              <span key={s.source}>
                {i > 0 && ' · '}
                {s.source} ({SOURCE_TIER_LABEL[s.tier]})
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* ── Conflicts (PART 32) ────────────────────────────────────────────── */}
      {action.hasConflict && (
        <Card className="border-danger/30 bg-danger-soft/40">
          <div className="flex items-start gap-3 p-4">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            <div className="text-sm">
              <div className="font-semibold text-danger">Sources disagree</div>
              <p className="mt-1 text-ink-secondary">
                This action will not be processed automatically. Resolve the disagreement against
                the primary source before approving.
              </p>
              <ul className="mt-2 space-y-1">
                {(action.conflicts ?? []).map((c) => (
                  <li key={c.field} className="font-mono text-xs">
                    <span className="font-semibold">{c.field}</span>:{' '}
                    {c.values.map((v) => `${v.source}=${String(v.value)}`).join(' vs ')}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      {/* ── Validation findings (PART 6) ───────────────────────────────────── */}
      {(errors.length > 0 || warnings.length > 0) && (
        <div className="space-y-2">
          {errors.map((f) => (
            <div
              key={f.code}
              className="flex items-start gap-2 rounded-lg bg-danger-soft/50 p-3 text-sm text-ink-secondary"
            >
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <span>
                <span className="font-mono text-xs text-danger">{f.code}</span> — {f.message}
              </span>
            </div>
          ))}
          {warnings.map((f) => (
            <div
              key={f.code}
              className="flex items-start gap-2 rounded-lg bg-warning-soft/50 p-3 text-sm text-ink-secondary"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>
                <span className="font-mono text-xs">{f.code}</span> — {f.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── The preview (PART 39) ──────────────────────────────────────────── */}
      {previewLoading && (
        <div className="flex items-center gap-2 p-4 text-sm text-ink-secondary">
          <Loader2 className="h-4 w-4 animate-spin" /> Computing impact…
        </div>
      )}

      {preview && (
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold">Corporate Action Preview</h3>
            <p className="text-xs text-ink-tertiary">
              {displayTicker(preview.symbol)} · {ACTION_LABEL[preview.actionType]}
              {preview.ratioLabel ? ` · ${preview.ratioLabel}` : ''}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
            <Metric label="Affected Clients" value={String(preview.affectedClients)} />
            <Metric
              label="Shares"
              value={`${formatNumber(preview.sharesBefore)} → ${formatNumber(preview.sharesAfter)}`}
            />
            <Metric
              label="Average Cost"
              value={
                preview.averageCostBefore !== null && preview.averageCostAfter !== null
                  ? `${formatCurrency(preview.averageCostBefore)} → ${formatCurrency(preview.averageCostAfter)}`
                  : '—'
              }
            />
            <Metric label="Cash Impact" value={formatCurrency(preview.cashImpact)} />
          </div>

          {/* The proof, rendered as the headline it is. */}
          <div
            className={cn(
              'mx-4 mb-4 rounded-lg p-4',
              expectsZeroImpact && !impactIsClean
                ? 'bg-warning-soft/50'
                : 'bg-success-soft/40',
            )}
          >
            <div className="flex items-start gap-3">
              {expectsZeroImpact && !impactIsClean ? (
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              ) : (
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-wide text-ink-tertiary">
                  Estimated Portfolio Value Impact
                </div>
                <div className="text-2xl font-semibold tabular-nums">
                  {formatCurrency(impact)}
                </div>
                <p className="mt-1 text-xs text-ink-secondary">
                  {expectsZeroImpact
                    ? impactIsClean
                      ? 'Economic value is preserved — the position is divided differently, not made ' +
                        'more or less valuable. This is what a correct ratio action looks like.'
                      : 'A ratio action should show no value impact. A non-zero figure here usually ' +
                        'means the quoted price has not yet been adjusted for the action — verify ' +
                        'before processing.'
                    : 'This action moves real cash, so a non-zero impact is expected.'}
                </p>
                <div className="mt-2 text-xs text-ink-tertiary">
                  {formatCurrency(preview.portfolioValueBefore)} before ·{' '}
                  {formatCurrency(preview.portfolioValueAfter)} after
                </div>
              </div>
            </div>
          </div>

          {preview.warnings.length > 0 && (
            <div className="border-t border-line px-4 py-3">
              {preview.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 py-1 text-xs text-ink-secondary">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                  {w}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Client impact (PART 40) ────────────────────────────────────────── */}
      {preview && preview.clients.length > 0 && (
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold">Client Impact</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-tertiary">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left">Client</th>
                  <th className="px-4 py-2 text-right">Shares</th>
                  <th className="px-4 py-2 text-right">Avg Cost</th>
                  <th className="px-4 py-2 text-right">Cash</th>
                  <th className="px-4 py-2 text-right">Value</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.clients.map((c) => (
                  <tr key={c.clientId} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2">
                      <div className="font-medium">{c.clientName}</div>
                      {c.note && <div className="text-xs text-ink-tertiary">{c.note}</div>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatNumber(c.quantityBefore)} → {formatNumber(c.quantityAfter)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(c.averageCostBefore, c.currency)} →{' '}
                      {formatCurrency(c.averageCostAfter, c.currency)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {c.cashImpact ? formatCurrency(c.cashImpact, c.currency) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(c.marketValueAfter, c.currency)}
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={c.status === 'READY' ? 'info' : 'neutral'}>{c.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── The applied ledger, once processed (PART 23) ───────────────────── */}
      {action.ledger.length > 0 && (
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold">Applied Ledger</h3>
            <p className="text-xs text-ink-tertiary">
              The permanent record of what changed. Never deleted, including on a re-run.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-tertiary">
                <tr className="border-b border-line">
                  <th className="px-4 py-2 text-left">Client</th>
                  <th className="px-4 py-2 text-right">Shares</th>
                  <th className="px-4 py-2 text-right">Avg Cost</th>
                  <th className="px-4 py-2 text-right">Cash</th>
                  <th className="px-4 py-2 text-left">Processed</th>
                  <th className="px-4 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {action.ledger.map((l) => (
                  <tr key={l.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-2">{l.client?.name ?? l.clientId}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatNumber(l.quantityBefore)} → {formatNumber(l.quantityAfter)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatCurrency(l.averageCostBefore, l.currency)} →{' '}
                      {formatCurrency(l.averageCostAfter, l.currency)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {l.cashImpact ? formatCurrency(l.cashImpact, l.currency) : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs">{formatDate(l.processedAt)}</td>
                    <td className="px-4 py-2">
                      <Badge tone={l.status === 'APPLIED' ? 'success' : l.status === 'FAILED' ? 'danger' : 'neutral'}>
                        {l.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Audit trail (PART 43) ──────────────────────────────────────────── */}
      {action.audit.length > 0 && (
        <Card>
          <div className="border-b border-line px-4 py-3">
            <h3 className="text-sm font-semibold">Audit Trail</h3>
          </div>
          <ul className="divide-y divide-line/60">
            {action.audit.map((a) => (
              <li key={a.id} className="px-4 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{a.action.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-ink-tertiary">{formatDate(a.createdAt)}</span>
                </div>
                <div className="text-xs text-ink-tertiary">
                  by {a.actorLabel}
                  {a.ipAddress ? ` · ${a.ipAddress}` : ''}
                  {a.reason ? ` — ${a.reason}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Actions (PART 8) ───────────────────────────────────────────────── */}
      {isActionable(action.status) && (
        <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-line bg-surface-1 py-3">
          <Button variant="secondary" onClick={onValidate} disabled={busy}>
            <ShieldCheck className="h-4 w-4" /> Validate
          </Button>

          {action.status !== 'APPROVED' && action.status !== 'FAILED' && (
            <Button onClick={onApprove} disabled={busy || errors.length > 0 || action.hasConflict}>
              <Check className="h-4 w-4" /> Approve
            </Button>
          )}

          {(action.status === 'APPROVED' || action.status === 'FAILED') && (
            <Button onClick={onProcess} disabled={busy || action.hasConflict}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              {action.status === 'FAILED' ? 'Re-run Processing' : 'Process'}
            </Button>
          )}

          <Button variant="ghost" onClick={onReject} disabled={busy}>
            <Ban className="h-4 w-4" /> Reject
          </Button>
        </div>
      )}

      {action.status === 'PROCESSED' && (
        <div className="flex items-center gap-2 rounded-lg bg-success-soft/40 p-3 text-sm text-ink-secondary">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          Applied on {action.processingDate ? formatDate(action.processingDate) : '—'}. Historical
          reports before {formatDate(action.effectiveDate)} still show the pre-action position.
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-ink-tertiary">{label}</div>
      <div className="mt-0.5 truncate">{children}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-ink-tertiary">{label}</div>
      <div className="mt-0.5 truncate font-semibold tabular-nums">{value}</div>
    </div>
  );
}
