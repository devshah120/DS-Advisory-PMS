'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, CornerDownLeft, ArrowUp, ArrowDown } from 'lucide-react';
import { allNavItems } from '@/lib/navigation';
import { cn } from '@/lib/utils';

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return allNavItems;
    return allNavItems.filter((i) => i.label.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, results.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      }
      if (e.key === 'Enter' && results[active]) {
        router.push(results[active].href);
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, results, active, router, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[120] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-xl overflow-hidden rounded-[16px] border border-border bg-white shadow-xl"
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-4.5 w-4.5 text-ink-tertiary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                placeholder="Search pages, clients, symbols…"
                className="w-full bg-transparent py-4 text-sm text-ink placeholder:text-ink-tertiary focus:outline-none"
              />
              <kbd className="hidden rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-2xs font-medium text-ink-tertiary sm:block">
                ESC
              </kbd>
            </div>

            <div className="max-h-80 overflow-y-auto p-2">
              {results.length === 0 ? (
                <p className="px-3 py-8 text-center text-[13px] text-ink-tertiary">
                  No results for “{query}”
                </p>
              ) : (
                results.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label + i}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => {
                        router.push(item.href);
                        onClose();
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left text-sm transition-colors',
                        i === active ? 'bg-brand-soft text-brand' : 'text-ink hover:bg-surface-3'
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1 font-medium">{item.label}</span>
                      {i === active && <CornerDownLeft className="h-3.5 w-3.5 opacity-60" />}
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-border bg-surface-2 px-4 py-2.5 text-2xs text-ink-tertiary">
              <span className="flex items-center gap-1">
                <ArrowUp className="h-3 w-3" />
                <ArrowDown className="h-3 w-3" /> navigate
              </span>
              <span className="flex items-center gap-1">
                <CornerDownLeft className="h-3 w-3" /> open
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
