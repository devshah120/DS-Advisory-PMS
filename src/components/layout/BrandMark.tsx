'use client';

import { cn } from '@/lib/utils';

/**
 * The Giriraj Global Consultants mark.
 *
 * This replaces a generic cube glyph that shipped as scaffolding and was never
 * meant to survive to a client-facing build. It is drawn rather than served as
 * an image file so it stays crisp at every size the shell uses it (sidebar,
 * collapsed rail, auth screens) and needs no extra network request on first
 * paint — the header is the first thing rendered after login.
 *
 * `/media/ggc-logo.mp4` remains the animated treatment for the auth panel; this
 * is the static equivalent for chrome, where a video would be absurd.
 */
export function BrandMark({
  className,
  size = 36,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-[10px]',
        'bg-gradient-to-br from-brand to-brand-active shadow-sm',
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 48 48"
        width={size * 0.58}
        height={size * 0.58}
        fill="none"
        role="img"
        aria-label="Giriraj Global Consultants"
      >
        {/* Outer G, drawn open at the right so the counter reads as a G rather
            than an O at 20px — the notch is the whole difference at this size. */}
        <path
          d="M38 15.5A16 16 0 1 0 40 24"
          stroke="#FFFFFF"
          strokeWidth="4.6"
          strokeLinecap="round"
        />
        {/* The G's crossbar, meeting the stem of the ascending mark. */}
        <path
          d="M40 24H27.5"
          stroke="#FFFFFF"
          strokeWidth="4.6"
          strokeLinecap="round"
        />
        {/* Ascending chart step inside the counter — the advisory half of the
            identity. Kept to three points; more becomes noise below 24px. */}
        <path
          d="M17.5 29.5l6.5-7 4.5 4.5 6.5-8"
          stroke="#FFFFFF"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.92"
        />
      </svg>
    </span>
  );
}
