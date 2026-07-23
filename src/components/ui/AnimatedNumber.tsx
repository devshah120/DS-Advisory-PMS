'use client';

/**
 * Renders a numeric value with the given formatter.
 *
 * (Previously this counted the value up on mount. The count-up tween was
 * removed because it leaked interpolation artifacts on integer stats — e.g.
 * "Total Clients" showing 7.999932746370387 — and made these cards behave
 * differently from every other card. The card's fade/slide-in still handles
 * the entrance animation.)
 */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  /** Accepted for backwards compatibility; no longer used. */
  duration?: number;
  className?: string;
}) {
  return <span className={className}>{format(value)}</span>;
}
