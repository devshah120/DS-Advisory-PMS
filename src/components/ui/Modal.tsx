'use client';

import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const sizeMap = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  // Wide enough for a report table to keep its columns on one line rather than
  // wrapping every cell; the panel bodies that use it scroll internally.
  '2xl': 'max-w-5xl',
};

export function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof sizeMap;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Capture phase + stopPropagation so Escape dismisses only this modal.
      // A Drawer underneath has its own document-level Escape handler, and
      // without this a single press would close both layers at once.
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);

    // Restore whatever the scroll lock was rather than clearing it: when this
    // modal was opened from inside a Drawer, that Drawer is still open
    // underneath and still needs the page locked.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  if (typeof document === 'undefined') return null;

  // z-[100] sits above the Drawer's z-[95]: a modal is always a response to
  // something, so a confirmation opened from inside a drawer has to sit on top
  // of it rather than behind its backdrop.
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.div
            className={cn(
              'relative w-full overflow-hidden rounded-[16px] border border-border bg-white shadow-xl',
              sizeMap[size]
            )}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {title || description ? (
              <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
                <div>
                  {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
                  {description && (
                    <p className="mt-1 text-[13px] text-ink-secondary">{description}</p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="-mr-1 -mt-1 rounded-lg p-1.5 text-ink-tertiary transition-colors hover:bg-surface-3 hover:text-ink"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            ) : (
              /* A titleless modal still needs a way out that isn't Escape or a
                 backdrop click — content that brings its own header (a report
                 panel, say) gets a floating close instead of a duplicate one. */
              <button
                onClick={onClose}
                aria-label="Close"
                className="absolute right-4 top-4 z-10 rounded-lg bg-white/80 p-1.5 text-ink-tertiary backdrop-blur transition-colors hover:bg-surface-3 hover:text-ink"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            )}
            {/* Capped so a long report table scrolls inside the modal instead of
                pushing the header and footer off the viewport. */}
            <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
            {footer && (
              <div className="flex items-center justify-end gap-3 border-t border-border bg-surface-2 px-6 py-4">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
