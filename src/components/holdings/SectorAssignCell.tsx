'use client';

import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { classificationApi } from '@/lib/classification.api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui';

/**
 * The sector dropdown shown against an unclassified position.
 *
 * Placed in the drill-down row rather than behind an edit page because the
 * decision is cheap and the queue is long: a reader who has just opened
 * "Unclassified — 8 positions" wants to clear all eight in one sitting, and a
 * round trip to a form per symbol would make that a chore they abandon halfway.
 *
 * The control classifies the SYMBOL, not this one holding row — so picking
 * Utilities against Radhika's SAHAJSOLAR also fixes Abhishek's and Keyur's, and
 * any account that buys it later. That reach is stated in the confirmation
 * toast rather than left to be discovered, because an edit that silently
 * changes three other accounts' reports would be a surprise worth avoiding.
 */
export function SectorAssignCell({
  symbol,
  sectors,
  /** How many accounts hold this symbol, for the confirmation message. */
  holderCount = 1,
  onAssigned,
}: {
  symbol: string;
  sectors: string[];
  holderCount?: number;
  onAssigned?: (symbol: string, sector: string) => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  async function assign(sector: string) {
    if (!sector) return;
    setSaving(true);
    try {
      const res = await classificationApi.setSector(symbol, sector);
      setSaved(sector);
      toast({
        tone: 'success',
        title: `${symbol} → ${sector}`,
        description:
          res.holdingsUpdated > 1
            ? `Applied to ${res.holdingsUpdated} accounts holding this symbol.`
            : 'Applied. Future purchases of this symbol inherit it.',
      });
      onAssigned?.(symbol, sector);
    } catch (e: any) {
      toast({
        tone: 'error',
        title: 'Could not set the sector',
        description: e?.response?.data?.message || 'Please try again.',
      });
    } finally {
      setSaving(false);
    }
  }

  // Once assigned the row is resolved; showing the chosen sector rather than a
  // still-open dropdown is what makes progress through the queue visible.
  if (saved) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success">
        <Check className="h-3.5 w-3.5" />
        {saved}
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className={cn(
          'h-8 rounded-lg border border-border bg-surface px-2 text-[13px] text-ink',
          'focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand',
          saving && 'opacity-60',
        )}
        defaultValue=""
        disabled={saving}
        aria-label={`Sector for ${symbol}`}
        onChange={(e) => assign(e.target.value)}
        // The drill-down row is itself clickable in some tables; keep a click on
        // the dropdown from also triggering the row behind it.
        onClick={(e) => e.stopPropagation()}
      >
        <option value="" disabled>
          Set sector…
        </option>
        {sectors.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-tertiary" />}
      {holderCount > 1 && !saving && (
        <span className="text-[11px] text-ink-tertiary">{holderCount} a/c</span>
      )}
    </div>
  );
}
