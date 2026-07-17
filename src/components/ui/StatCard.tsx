'use client';

import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatedNumber } from './AnimatedNumber';

interface StatCardProps {
  label: string;
  value: number;
  format: (n: number) => string;
  icon?: ReactNode;
  delta?: number; // percentage delta, e.g. +1.8
  deltaLabel?: string;
  sublabel?: string;
  spark?: ReactNode;
  accent?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
  index?: number;
}

const accentBg: Record<NonNullable<StatCardProps['accent']>, string> = {
  brand: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-3 text-ink-secondary',
};

export function StatCard({
  label,
  value,
  format,
  icon,
  delta,
  deltaLabel,
  sublabel,
  spark,
  accent = 'neutral',
  index = 0,
}: StatCardProps) {
  const deltaUp = (delta ?? 0) >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="card card-hover p-5"
    >
      <div className="flex items-start justify-between">
        <p className="text-[13px] font-medium text-ink-secondary">{label}</p>
        {icon && (
          <span
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-[10px]',
              accentBg[accent]
            )}
          >
            {icon}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <AnimatedNumber
          value={value}
          format={format}
          className="value-display text-[26px] font-semibold leading-none text-ink"
        />
        {spark && <div className="h-9 w-20 shrink-0">{spark}</div>}
      </div>

      <div className="mt-3 flex items-center gap-2">
        {delta !== undefined && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
              deltaUp ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'
            )}
          >
            {deltaUp ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {Math.abs(delta).toFixed(2)}%
          </span>
        )}
        {(deltaLabel || sublabel) && (
          <span className="text-xs text-ink-tertiary">{deltaLabel ?? sublabel}</span>
        )}
      </div>
    </motion.div>
  );
}
