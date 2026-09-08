'use client';

import { type Market } from '@/lib/market-scope';
import { cn } from '@/lib/utils';

/**
 * Country flags drawn as inline SVG rather than emoji.
 *
 * MARKET_META carries a `flag` emoji ('🇺🇸'), and it is genuinely unrenderable on
 * a large share of the desk's machines: those characters are a pair of regional
 * indicator letters, and Windows ships no font that composes them into a flag.
 * Chrome and Edge on Windows therefore fall back to drawing the two letters, so
 * the switcher read "US"/"IN" on desktop while looking correct on phones — the
 * platforms whose fonts do have the glyphs. No CSS or font-stack tweak fixes
 * that; the glyph simply does not exist locally.
 *
 * Drawing the flags ourselves removes the font from the equation entirely, so
 * every platform gets the same mark. They are deliberately simple, 3:2, and
 * carry a hairline border because both flags are white at one edge and would
 * otherwise bleed into a white menu background.
 */
export function FlagIcon({
  market,
  className,
}: {
  market: Market;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-block shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/10',
        'h-[14px] w-[21px]',
        className
      )}
      aria-hidden="true"
    >
      {market === 'INDIA' ? <IndiaFlag /> : <USFlag />}
    </span>
  );
}

function IndiaFlag() {
  return (
    <svg viewBox="0 0 36 24" className="h-full w-full" preserveAspectRatio="none">
      <rect width="36" height="8" fill="#FF9933" />
      <rect y="8" width="36" height="8" fill="#FFFFFF" />
      <rect y="16" width="36" height="8" fill="#138808" />
      {/* Ashoka Chakra — the spokes are far too fine to read at 14px, so the
          wheel is drawn as a ring plus a hub, which is what the eye resolves. */}
      <circle cx="18" cy="12" r="3.2" fill="none" stroke="#000080" strokeWidth="1" />
      <circle cx="18" cy="12" r="0.9" fill="#000080" />
    </svg>
  );
}

function USFlag() {
  return (
    <svg viewBox="0 0 36 24" className="h-full w-full" preserveAspectRatio="none">
      <rect width="36" height="24" fill="#FFFFFF" />
      {/* Seven red stripes of thirteen; at this size the full thirteen would
          alias into a solid block, so the stripe height is the honest limit. */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} y={i * 3.692} width="36" height="1.846" fill="#B22234" />
      ))}
      <rect width="15.2" height="12.92" fill="#3C3B6E" />
      {/* A suggestion of the union's stars — a 5x4 dot grid reads correctly at
          this scale where fifty stars would smear. */}
      {[0, 1, 2, 3].map((row) =>
        [0, 1, 2, 3, 4].map((col) => (
          <circle
            key={`${row}-${col}`}
            cx={1.9 + col * 2.85}
            cy={1.9 + row * 3.05}
            r="0.75"
            fill="#FFFFFF"
          />
        ))
      )}
    </svg>
  );
}
