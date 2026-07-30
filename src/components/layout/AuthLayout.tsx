'use client';

import { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { LineChart, Globe2, Layers } from 'lucide-react';

const highlights = [
  { icon: LineChart, title: 'Real-time analytics', desc: 'Live performance and risk insights across every holding.' },
  { icon: Globe2, title: 'Global ETF access', desc: 'Country, commodity, and sectoral ETFs in one workspace.' },
  { icon: Layers, title: 'Equity-first coverage', desc: 'Direct equities and thematic opportunities, tracked precisely.' },
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-app">
      {/* Video panel — edge to edge, no padding */}
      <div className="relative hidden w-1/2 overflow-hidden bg-[#fbfbfa] lg:flex lg:items-center lg:justify-center">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="h-[78%] w-full object-contain"
          style={{ transform: 'translateZ(0) translateY(-6%)' }}
        >
          <source src="/media/ggc-logo.mp4" type="video/mp4" />
        </video>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col overflow-y-auto px-6 py-8 lg:w-1/2 lg:px-14 lg:py-10">
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <div className="mb-7 flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-ink/5">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] text-ink" fill="none">
                <path d="M12 3L4 7.5v9L12 21l8-4.5v-9L12 3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M12 3v18M4 7.5l8 4.5 8-4.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-[15px] font-semibold tracking-tight text-ink">Giriraj Global Capital</span>
          </div>

          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-[22px] font-semibold leading-tight tracking-tight text-ink"
          >
            Equity advisory built around global ETFs and focused opportunities.
          </motion.h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">
            Country, commodity, and sectoral ETFs alongside direct equity positions — managed and reported with precision.
          </p>

          <div className="mt-5 space-y-3">
            {highlights.map((h, i) => {
              const Icon = h.icon;
              return (
                <motion.div
                  key={h.title}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.08, duration: 0.35 }}
                  className="flex items-start gap-2.5"
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-ink/5 text-ink">
                    <Icon className="h-[14px] w-[14px]" />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-ink">{h.title}</p>
                    <p className="text-[12px] text-ink-secondary">{h.desc}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="my-7 h-px w-full bg-border" />

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 text-[12px] text-ink-tertiary lg:justify-start">
          <span>Giriraj Global Capital LLP</span>
          <span className="h-1 w-1 rounded-full bg-ink/20" />
          <span>Equity &amp; ETF advisory</span>
        </div>
      </div>
    </div>
  );
}
