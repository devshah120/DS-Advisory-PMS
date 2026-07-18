'use client';

import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { AllocationSlice } from '@/types';
import { TooltipShell, TooltipRow } from './ChartTooltip';

/**
 * Fixed hue order, validated for adjacent-pair CVD separation against this
 * app's white card surface (see the data-viz color formula). A pie's slices
 * are sorted by size, so only neighbors in that ranking ever sit next to each
 * other — this is the "adjacent" case the palette was validated against, not
 * "all pairs" (which only applies to scatter/bubble/choropleth forms).
 */
const SECTOR_COLORS = [
  '#2a78d6', // blue
  '#008300', // green
  '#e87ba4', // magenta
  '#eda100', // yellow
  '#1baf7a', // aqua
  '#eb6834', // orange
  '#4a3aa7', // violet
  '#e34948', // red
];
const OTHER_COLOR = '#9ca3af';
const MAX_SLICES = SECTOR_COLORS.length;

interface Slice {
  key: string;
  value: number;
  weight: number;
  color: string;
}

/** Top N sectors by weight; anything past that folds into "Other" rather than cycling colors. */
function toSlices(allocation: AllocationSlice[]): Slice[] {
  const sorted = [...allocation].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, MAX_SLICES).map((s, i) => ({ ...s, color: SECTOR_COLORS[i] }));
  const tail = sorted.slice(MAX_SLICES);

  if (tail.length === 0) return head;

  const otherValue = tail.reduce((sum, s) => sum + s.value, 0);
  const otherWeight = tail.reduce((sum, s) => sum + s.weight, 0);
  return [...head, { key: 'Other', value: otherValue, weight: otherWeight, color: OTHER_COLOR }];
}

export function SectorPieChart({ allocation }: { allocation: AllocationSlice[] }) {
  const slices = toSlices(allocation);
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (slices.length === 0 || total === 0) {
    return <p className="py-8 text-center text-sm text-ink-tertiary">No holdings to allocate.</p>;
  }

  const mid = Math.ceil(slices.length / 2);
  const leftCol = slices.slice(0, mid);
  const rightCol = slices.slice(mid);

  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-6">
      <PieChart width={240} height={240}>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="key"
          cx="50%"
          cy="50%"
          innerRadius={62}
          outerRadius={112}
          paddingAngle={1.5}
          strokeWidth={2}
          stroke="#ffffff"
          isAnimationActive={false}
        >
          {slices.map((s) => (
            <Cell key={s.key} fill={s.color} />
          ))}
        </Pie>
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload || payload.length === 0) return null;
            const s = payload[0].payload as Slice;
            return (
              <TooltipShell>
                <TooltipRow
                  color={s.color}
                  name={s.key}
                  value={`${(s.weight * 100).toFixed(1)}%`}
                />
              </TooltipShell>
            );
          }}
        />
      </PieChart>

      <div className="grid w-full grid-cols-2 gap-x-6 gap-y-2.5">
        <ul className="flex flex-col gap-2.5">
          {leftCol.map((s) => (
            <LegendRow key={s.key} slice={s} />
          ))}
        </ul>
        <ul className="flex flex-col gap-2.5">
          {rightCol.map((s) => (
            <LegendRow key={s.key} slice={s} />
          ))}
        </ul>
      </div>
    </div>
  );
}

function LegendRow({ slice }: { slice: Slice }) {
  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <span className="flex items-center gap-2 truncate text-ink-secondary">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} />
        <span className="truncate">{slice.key}</span>
      </span>
      <span className="shrink-0 font-semibold tabular-nums text-ink">
        {(slice.weight * 100).toFixed(1)}%
      </span>
    </li>
  );
}
