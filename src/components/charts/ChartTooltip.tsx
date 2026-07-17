'use client';

import { ReactNode } from 'react';

/** Shared premium tooltip surface for all charts. */
export function TooltipShell({
  label,
  children,
}: {
  label?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-border bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      {label !== undefined && (
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">
          {label}
        </p>
      )}
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function TooltipRow({
  color,
  name,
  value,
}: {
  color: string;
  name: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-6 text-[13px]">
      <span className="flex items-center gap-1.5 text-ink-secondary">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        {name}
      </span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
    </div>
  );
}
