import { TopHolding } from '@/types';
import { cn } from '@/lib/utils';

const RANK_COLORS = [
  '#2a78d6', // blue
  '#008300', // green
  '#e87ba4', // magenta
  '#eda100', // yellow
  '#1baf7a', // aqua
  '#eb6834', // orange
  '#4a3aa7', // violet
  '#e34948', // red
  '#0891b2', // cyan
  '#7c3aed', // purple
];
const REST_COLOR = '#9ca3af';
const TOP_N = 10;

export function TopHoldingsList({ holdings }: { holdings: TopHolding[] }) {
  if (holdings.length === 0) {
    return <p className="py-8 text-center text-sm text-ink-tertiary">No holdings to rank.</p>;
  }

  const top = holdings.slice(0, TOP_N);
  const rest = holdings.slice(TOP_N);
  const restWeight = rest.reduce((sum, h) => sum + h.weight, 0);

  return (
    <ul className="space-y-1">
      {top.map((h, i) => (
        <li key={h.ticker} className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
              style={{ background: RANK_COLORS[i] }}
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{h.ticker}</p>
              <p className="truncate text-xs text-ink-tertiary">
                {h.company}
                {h.numClients > 1 ? ` · ${h.numClients} clients` : ''}
              </p>
            </div>
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">
            {(h.weight * 100).toFixed(1)}%
          </span>
        </li>
      ))}

      {rest.length > 0 && (
        <li className="flex items-center justify-between gap-3 pt-2 text-[13px]">
          <span className="flex items-center gap-2.5 text-ink-secondary">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full" style={{ background: REST_COLOR }}>
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            <span>Rest of portfolio ({rest.length} holdings)</span>
          </span>
          <span className={cn('shrink-0 font-semibold tabular-nums text-ink-secondary')}>
            {(restWeight * 100).toFixed(1)}%
          </span>
        </li>
      )}
    </ul>
  );
}
