'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const tones: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-secondary',
  brand: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-[#b45309]',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-[#0369a1]',
};

const dotTones: Record<Tone, string> = {
  neutral: 'bg-ink-tertiary',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
  className,
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span className={cn('chip', tones[tone], className)} title={title}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dotTones[tone])} />}
      {children}
    </span>
  );
}
