'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface MenuItemDef {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  tone?: 'default' | 'danger';
  divider?: boolean;
}

export function Dropdown({
  trigger,
  items,
  align = 'right',
  width = 200,
}: {
  trigger: ReactNode;
  items: MenuItemDef[];
  align?: 'left' | 'right';
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            style={{ width }}
            className={cn(
              'absolute z-50 mt-2 overflow-hidden rounded-[12px] border border-border bg-white p-1.5 shadow-lg',
              align === 'right' ? 'right-0' : 'left-0'
            )}
          >
            {items.map((item, i) =>
              item.divider ? (
                <div key={i} className="my-1.5 h-px bg-border" />
              ) : (
                <button
                  key={i}
                  onClick={() => {
                    item.onClick?.();
                    setOpen(false);
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13px] font-medium transition-colors',
                    item.tone === 'danger'
                      ? 'text-danger hover:bg-danger-soft'
                      : 'text-ink hover:bg-surface-3'
                  )}
                >
                  {item.icon && (
                    <span className={cn(item.tone === 'danger' ? 'text-danger' : 'text-ink-tertiary')}>
                      {item.icon}
                    </span>
                  )}
                  {item.label}
                </button>
              )
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
