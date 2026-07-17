'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-[12px] border border-border bg-surface-2 p-1',
        className
      )}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className={cn(
              'relative z-10 inline-flex items-center gap-1.5 rounded-[9px] px-3.5 py-1.5 text-[13px] font-medium transition-colors',
              active ? 'text-ink' : 'text-ink-secondary hover:text-ink'
            )}
          >
            {active && (
              <motion.span
                layoutId="tab-pill"
                className="absolute inset-0 -z-10 rounded-[9px] bg-white shadow-sm ring-1 ring-border"
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              />
            )}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
                  active ? 'bg-brand-soft text-brand' : 'bg-surface-3 text-ink-tertiary'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
