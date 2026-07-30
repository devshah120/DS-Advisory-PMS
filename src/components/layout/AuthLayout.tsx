'use client';

import { ReactNode } from 'react';
import { motion } from 'framer-motion';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-app">
      {/* Video panel — edge to edge, no padding */}
      <div className="relative hidden w-1/2 overflow-hidden bg-white lg:flex lg:items-center lg:justify-center">
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          className="h-[78%] w-full object-contain"
          style={{ transform: 'translateZ(0) translateY(-6%)', filter: 'brightness(1.06) contrast(1.03)' }}
        >
          <source src="/media/ggc-logo.mp4" type="video/mp4" />
        </video>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col items-center justify-center overflow-y-auto px-6 py-8 lg:w-1/2 lg:px-14 lg:py-10">
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {children}
          </motion.div>
        </div>

        <div className="mt-6 flex items-center justify-center text-[12px] text-ink-tertiary">
          <span>&copy; {new Date().getFullYear()} Giriraj Global Capital LLP. All rights reserved.</span>
        </div>
      </div>
    </div>
  );
}
