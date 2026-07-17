'use client';

import { ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Maximize2, Minimize2, X } from 'lucide-react';

export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  children,
  width = 460,
  maximizable = false,
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  width?: number;
  /** Shows a toggle that expands the drawer to fill the viewport width — for wide tables that would otherwise scroll horizontally. */
  maximizable?: boolean;
}) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  // Reset to the compact panel each time the drawer closes, so it doesn't
  // reopen maximized from a prior session.
  useEffect(() => {
    if (!isOpen) setMaximized(false);
  }, [isOpen]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[95]">
          <motion.div
            className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            className="absolute right-0 top-0 flex h-full max-w-full flex-col bg-white shadow-xl"
            style={{ width: maximized ? '100vw' : width }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
              <div>
                {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
                {description && (
                  <p className="mt-1 text-[13px] text-ink-secondary">{description}</p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {maximizable && (
                  <button
                    onClick={() => setMaximized((m) => !m)}
                    className="-mr-1 rounded-lg p-1.5 text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-ink"
                    title={maximized ? 'Restore' : 'Maximize'}
                  >
                    {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="-mr-1 rounded-lg p-1.5 text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
