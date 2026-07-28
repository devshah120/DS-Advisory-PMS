'use client';

import { useState, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { FundamentalView, FundamentalPillar } from '@/types';
import { cn } from '@/lib/utils';

const PILLAR_LABELS: Record<FundamentalPillar, string> = {
  growth: 'Growth',
  profitability: 'Profitability',
  financialStrength: 'Financial Strength',
  valuation: 'Valuation',
  momentum: 'Momentum',
};

const PILLAR_ORDER: FundamentalPillar[] = ['growth', 'profitability', 'financialStrength', 'valuation', 'momentum'];

function scoreTone(score: number) {
  if (score >= 75) return 'text-success';
  if (score >= 50) return 'text-warning';
  return 'text-danger';
}

/** The Atlas Fundamental Score badge — hovering reveals the full pillar + per-metric breakdown that produced it. */
export function ScoreHoverCard({ view }: { view: FundamentalView }) {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  };
  const hide = () => {
    timeoutRef.current = setTimeout(() => setOpen(false), 100);
  };

  return (
    <div className="relative inline-block" onMouseEnter={show} onMouseLeave={hide}>
      <span
        className={cn(
          'inline-flex h-8 min-w-[3rem] cursor-default items-center justify-center rounded-[8px] px-2 text-[13px] font-bold tabular-nums',
          view.overallScore >= 75
            ? 'bg-success-soft text-success'
            : view.overallScore >= 50
              ? 'bg-warning-soft text-[#b45309]'
              : 'bg-danger-soft text-danger',
        )}
      >
        {view.overallScore.toFixed(0)}
      </span>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute left-1/2 top-full z-50 mt-2 w-[380px] -translate-x-1/2 rounded-[14px] border border-border bg-white p-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border pb-2.5">
              <div>
                <p className="text-[13px] font-semibold text-ink">{view.symbol}</p>
                <p className="text-[11px] text-ink-tertiary">{view.strategy} strategy</p>
              </div>
              <span className={cn('text-2xl font-bold tabular-nums', scoreTone(view.overallScore))}>
                {view.overallScore.toFixed(1)}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {PILLAR_ORDER.map((pillar) => {
                const metrics = view.breakdown.filter((m) => m.pillar === pillar);
                const pillarScore =
                  pillar === 'growth'
                    ? view.growthScore
                    : pillar === 'profitability'
                      ? view.profitabilityScore
                      : pillar === 'financialStrength'
                        ? view.financialStrengthScore
                        : pillar === 'valuation'
                          ? view.valuationScore
                          : view.momentumScore;

                return (
                  <div key={pillar}>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-tertiary">
                        {PILLAR_LABELS[pillar]}
                      </p>
                      <p className={cn('text-[12px] font-bold tabular-nums', scoreTone(pillarScore))}>
                        {pillarScore.toFixed(1)}
                      </p>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {metrics.map((m) => (
                        <div key={m.metric} className="flex items-center justify-between text-[11px]">
                          <span className="text-ink-secondary">{m.metric}</span>
                          <span className="flex items-center gap-2 tabular-nums">
                            <span className="text-ink-tertiary">{m.value != null ? m.value.toFixed(1) : '—'}</span>
                            <span
                              className={cn(
                                'w-9 text-right font-medium',
                                m.score == null ? 'text-ink-tertiary' : scoreTone(m.score),
                              )}
                            >
                              {m.score != null ? m.score.toFixed(0) : 'n/a'}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
