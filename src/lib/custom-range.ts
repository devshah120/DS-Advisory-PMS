/**
 * Bounds and validation for the Performance sheet's custom date range.
 *
 * This exists because a native `<input type="date">` reports EVERY keystroke as
 * a change, including the half-typed ones. Typing "2026" into the year field
 * emits 0002, 0020, 0202 and finally 2026 — four distinct, individually valid
 * dates. A sheet that refetches on each of them shows a request for the year 26
 * AD, which the period engine then correctly (and confusingly) reports as
 * "36510 days short of the full window" while the user is still mid-keystroke.
 *
 * The fix is to treat a date as an ANSWER only once it is complete and inside
 * the range the book can actually measure, and to leave the previous window on
 * screen until then.
 */

/**
 * The fallback floor, used ONLY until the client's own inception has loaded.
 *
 * This used to be the floor for everybody, on the reasoning that 30-June-2026
 * was a fixed historical fact about the book and a wrong bound here would cost
 * nothing because the server clamps independently. Both halves were wrong. It
 * is not a fact about every client — a mandate can start earlier — and the cost
 * was not nothing: a `min` on a date input is enforced by the BROWSER, so a
 * December-2025 range could not be typed or picked at all. The server never got
 * the chance to answer correctly, because the question was never sent.
 *
 * Each client's real floor now arrives on every period option as
 * `inceptionIso` (see availablePeriods on the server), and the helpers below
 * take it as a parameter. This constant remains only as the pre-load default.
 */
export const DEFAULT_INCEPTION_ISO = '2026-06-30';

/** Today, as the ISO day string the date input speaks. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Is this a complete, in-range day the sheet can actually measure?
 *
 * Three things have to hold, and the year check is the one that matters here:
 * a `<input type="date">` yields `YYYY-MM-DD` with a zero-padded year while the
 * user types, so "0026-07-15" parses perfectly well as a Date and is exactly
 * what must NOT trigger a fetch.
 */
export function isCompleteDay(value: string, inceptionIso = DEFAULT_INCEPTION_ISO): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // A four-digit year that is still obviously partial — 0026, 0202 — is a
  // keystroke, not a request. The floor is the CLIENT'S inception, so this
  // still rejects the half-typed years without rejecting real early history.
  return value >= inceptionIso;
}

/**
 * Is the pair a range worth sending?
 *
 * Both ends complete, and `from` strictly before `to`. A reversed or zero-length
 * range is rejected here rather than at the server so the user gets a quiet "not
 * yet" while typing instead of an error banner that replaces their figures.
 */
export function isUsableRange(
  from: string,
  to: string,
  inceptionIso = DEFAULT_INCEPTION_ISO,
): boolean {
  return isCompleteDay(from, inceptionIso) && isCompleteDay(to, inceptionIso) && from < to;
}

/**
 * Why a range is not usable yet, in words, or null when it is fine.
 *
 * Returned as a hint beside the inputs rather than thrown: while someone is
 * typing a year the honest state is "keep going", not "error".
 */
export function rangeHint(
  from: string,
  to: string,
  inceptionIso = DEFAULT_INCEPTION_ISO,
): string | null {
  if (!from) return 'Choose a start date to measure a custom range.';
  if (!isCompleteDay(from, inceptionIso)) {
    return `Enter a full start date — this mandate has no history before ${inceptionIso}.`;
  }
  if (!isCompleteDay(to, inceptionIso)) return 'Enter a full end date.';
  if (from >= to) return 'The start date must fall before the end date.';
  return null;
}
