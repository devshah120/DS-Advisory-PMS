'use client';

/**
 * Manual entry of a corporate action.
 *
 * This is the path for the HIGHEST-confidence sources: an action keyed from a
 * company's own IR announcement or an exchange filing scores 100 under PART
 * 33, outranking anything an API reports. PART 5's hierarchy only means
 * something if a human can enter its top two tiers.
 *
 * ── The one piece of real UI thinking here ──────────────────────────────────
 *
 * A split is SPOKEN as "2-for-1" (two new shares for each old one) but STORED
 * as oldRatio=1, newRatio=2 (see PART 6). Asking a user for "old ratio" and
 * "new ratio" invites them to type 2 and 1 — which stores a HALVING and would
 * cut every client's position instead of doubling it.
 *
 * So the form asks the question the way the desk says it out loud —
 * "[2] new shares for every [1] held" — and inverts on submit. The live
 * preview line underneath states the outcome in plain English ("100 shares
 * would become 200"), because the cheapest place to catch an inverted ratio is
 * before it is saved, not in the Review Center afterwards.
 */

import { useMemo, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  ACTION_LABEL,
  corporateActionsApi,
  type CorporateActionDetail,
  type CorporateActionType,
  type CreateCorporateActionInput,
  type SourceTier,
} from '@/lib/corporate-actions.api';
import { useToast } from '@/components/ui';
import { Button, Input, Select } from '@/components/ui';

/** Types that take a ratio, and how their two legs should be labelled. */
const RATIO_PROMPT: Partial<Record<CorporateActionType, { received: string; held: string }>> = {
  STOCK_SPLIT: { received: 'new shares for every', held: 'held' },
  REVERSE_SPLIT: { received: 'new share for every', held: 'held' },
  BONUS_ISSUE: { received: 'bonus shares for every', held: 'held' },
  STOCK_DIVIDEND: { received: 'new shares for every', held: 'held' },
};

const CASH_TYPES: CorporateActionType[] = [
  'DIVIDEND',
  'SPECIAL_DIVIDEND',
  'CASH_DISTRIBUTION',
  'RETURN_OF_CAPITAL',
];

const TARGET_TYPES: CorporateActionType[] = [
  'SPIN_OFF',
  'MERGER',
  'ACQUISITION',
  'TICKER_CHANGE',
];

/** Only the tiers a human may legitimately claim — see the DTO's note. */
const MANUAL_TIERS: Array<{ value: SourceTier; label: string }> = [
  { value: 'COMPANY_IR', label: 'Official company IR announcement (100)' },
  { value: 'REGULATORY_FILING', label: 'SEC / exchange filing (100)' },
  { value: 'EXCHANGE', label: 'Exchange notice (95)' },
  { value: 'UNVERIFIED', label: 'Unverified (40)' },
];

export function CorporateActionForm({
  onDone,
  onCancel,
}: {
  onDone: (created: CorporateActionDetail | null) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const [actionType, setActionType] = useState<CorporateActionType>('STOCK_SPLIT');
  const [symbol, setSymbol] = useState('');
  const [company, setCompany] = useState('');

  // Ratio, in SPOKEN order: `received` for every `held`.
  const [received, setReceived] = useState('2');
  const [held, setHeld] = useState('1');

  const [cashAmount, setCashAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [newSymbol, setNewSymbol] = useState('');
  const [newCompany, setNewCompany] = useState('');

  const [announcementDate, setAnnouncementDate] = useState('');
  const [recordDate, setRecordDate] = useState('');
  const [exDate, setExDate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [paymentDate, setPaymentDate] = useState('');

  const [source, setSource] = useState('');
  const [tier, setTier] = useState<SourceTier>('COMPANY_IR');
  const [sourceUrl, setSourceUrl] = useState('');
  const [notes, setNotes] = useState('');

  const ratioPrompt = RATIO_PROMPT[actionType];
  const takesCash = CASH_TYPES.includes(actionType);
  const takesTarget = TARGET_TYPES.includes(actionType);

  /**
   * The plain-English read-back. This is the form's most important element:
   * an inverted ratio is invisible in two number boxes and obvious in a
   * sentence.
   */
  const outcome = useMemo(() => {
    const r = Number(received);
    const h = Number(held);
    if (!ratioPrompt || !Number.isFinite(r) || !Number.isFinite(h) || r <= 0 || h <= 0) return null;

    if (actionType === 'BONUS_ISSUE' || actionType === 'STOCK_DIVIDEND') {
      const additional = 100 * (r / h);
      return `A client holding 100 shares would receive ${trim(additional)} more, ending with ${trim(100 + additional)}.`;
    }

    const after = 100 * (r / h);
    return `A client holding 100 shares would end with ${trim(after)}, at ${trim(100 / (r / h))}% of the previous average cost.`;
  }, [actionType, received, held, ratioPrompt]);

  const submit = async () => {
    if (!symbol.trim() || !effectiveDate || !source.trim()) {
      toast({ tone: 'warning', title: 'Symbol, effective date and source are required' });
      return;
    }

    setSaving(true);
    try {
      const input: CreateCorporateActionInput = {
        symbol: symbol.trim().toUpperCase(),
        company: company.trim() || undefined,
        actionType,
        effectiveDate,
        announcementDate: announcementDate || undefined,
        recordDate: recordDate || undefined,
        exDate: exDate || undefined,
        paymentDate: paymentDate || undefined,
        source: source.trim(),
        tier,
        sourceUrl: sourceUrl.trim() || undefined,
        notes: notes.trim() || undefined,
      };

      if (ratioPrompt) {
        // THE INVERSION. Spoken "N for every M" is stored oldRatio=M,
        // newRatio=N — see the note at the top of this file.
        input.oldRatio = Number(held);
        input.newRatio = Number(received);
      }

      if (takesCash) {
        input.cashAmount = Number(cashAmount);
        input.currency = currency;
      }

      if (takesTarget) {
        input.newSymbol = newSymbol.trim().toUpperCase() || undefined;
        input.newCompany = newCompany.trim() || undefined;
      }

      const result = await corporateActionsApi.create(input);

      toast({
        tone: result.validation.valid ? 'success' : 'warning',
        title: result.merged
          ? 'Merged into an existing action'
          : `${input.symbol} ${ACTION_LABEL[actionType]} recorded`,
        description: result.validation.valid
          ? undefined
          : result.validation.findings
              .filter((f) => f.severity === 'ERROR')
              .map((f) => f.message)
              .join(' '),
      });

      await onDone(result.action);
    } catch (error) {
      toast({ tone: 'error', title: 'Could not save', description: message(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select
          label="Action type"
          value={actionType}
          onChange={(e) => setActionType(e.target.value as CorporateActionType)}
        >
          {(Object.keys(ACTION_LABEL) as CorporateActionType[]).map((t) => (
            <option key={t} value={t}>
              {ACTION_LABEL[t]}
            </option>
          ))}
        </Select>

        <Input
          label="Symbol"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="APH or RELIANCE.NS"
        />

        <Input
          label="Company (optional)"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Amphenol Corporation"
        />

        <Input
          label="Effective date"
          type="date"
          value={effectiveDate}
          onChange={(e) => setEffectiveDate(e.target.value)}
        />
      </div>

      {ratioPrompt && (
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <Input
              label="Ratio"
              className="w-20"
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              inputMode="decimal"
            />
            <span className="pb-2 text-ink-secondary">{ratioPrompt.received}</span>
            <Input
              label=""
              className="w-20"
              value={held}
              onChange={(e) => setHeld(e.target.value)}
              inputMode="decimal"
            />
            <span className="pb-2 text-ink-secondary">{ratioPrompt.held}</span>
          </div>
          {outcome && (
            <p className="mt-2 text-xs text-ink-secondary">
              <span className="font-medium">Check this reads correctly: </span>
              {outcome}
            </p>
          )}
        </div>
      )}

      {takesCash && (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Amount per share"
            value={cashAmount}
            onChange={(e) => setCashAmount(e.target.value)}
            inputMode="decimal"
            placeholder="1.00"
          />
          <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="USD">USD</option>
            <option value="INR">INR</option>
          </Select>
        </div>
      )}

      {takesTarget && (
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Resulting symbol"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            placeholder="XYZ"
          />
          <Input
            label="Resulting company"
            value={newCompany}
            onChange={(e) => setNewCompany(e.target.value)}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Input
          label="Announced"
          type="date"
          value={announcementDate}
          onChange={(e) => setAnnouncementDate(e.target.value)}
        />
        <Input
          label="Record date"
          type="date"
          value={recordDate}
          onChange={(e) => setRecordDate(e.target.value)}
        />
        <Input label="Ex date" type="date" value={exDate} onChange={(e) => setExDate(e.target.value)} />
        <Input
          label="Payment date"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select label="Source tier" value={tier} onChange={(e) => setTier(e.target.value as SourceTier)}>
          {MANUAL_TIERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
        <Input
          label="Source"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Amphenol 8-K, 6 Aug 2026"
        />
      </div>

      <Input
        label="Source URL"
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
        placeholder="https://investors.amphenol.com/…"
      />

      {!sourceUrl.trim() && (
        <p className="flex items-start gap-2 text-xs text-ink-tertiary">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          Without a URL a reviewer cannot verify this action against its source. It will be saved
          with a warning.
        </p>
      )}

      <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Record action
        </Button>
      </div>
    </div>
  );
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
}

function message(error: unknown): string {
  const axiosLike = error as { response?: { data?: { message?: string | string[] } } };
  const detail = axiosLike?.response?.data?.message;
  if (Array.isArray(detail)) return detail.join(' ');
  if (typeof detail === 'string') return detail;
  return error instanceof Error ? error.message : 'Unexpected error';
}
