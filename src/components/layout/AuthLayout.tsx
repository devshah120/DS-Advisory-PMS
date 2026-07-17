'use client';

import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, TrendingUp, Globe } from 'lucide-react';

const highlights = [
  { icon: TrendingUp, title: 'Real-time analytics', desc: 'Institutional-grade performance and risk insights.' },
  { icon: ShieldCheck, title: 'Bank-grade security', desc: 'SOC 2 Type II, encryption at rest and in transit.' },
  { icon: Globe, title: 'Multi-asset coverage', desc: 'Equities, fixed income, alternatives in one view.' },
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-app">
      {/* Brand panel */}
      <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-brand-active via-brand to-[#1e3a8a] lg:flex lg:flex-col lg:justify-between lg:p-12">
        {/* subtle grid */}
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-white/10 blur-3xl" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[12px] bg-white/15 backdrop-blur">
            <svg viewBox="0 0 24 24" className="h-6 w-6 text-white" fill="none">
              <path d="M12 3L4 7.5v9L12 21l8-4.5v-9L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M12 3v18M4 7.5l8 4.5 8-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight text-white">DS Advisory</span>
        </div>

        <div className="relative z-10">
          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="max-w-md text-[32px] font-semibold leading-tight tracking-tight text-white"
          >
            The portfolio management platform trusted by institutional investors.
          </motion.h2>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-white/70">
            Manage mandates, monitor performance, and report with precision — all from a single, elegant workspace.
          </p>

          <div className="mt-10 space-y-5">
            {highlights.map((h, i) => {
              const Icon = h.icon;
              return (
                <motion.div
                  key={h.title}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + i * 0.1, duration: 0.4 }}
                  className="flex items-start gap-3.5"
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/15 text-white backdrop-blur">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-white">{h.title}</p>
                    <p className="text-[13px] text-white/65">{h.desc}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-6 text-[13px] text-white/50">
          <span>$48B+ AUM</span>
          <span className="h-1 w-1 rounded-full bg-white/30" />
          <span>320+ firms</span>
          <span className="h-1 w-1 rounded-full bg-white/30" />
          <span>Since 2019</span>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex w-full items-center justify-center px-6 py-12 lg:w-1/2">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
