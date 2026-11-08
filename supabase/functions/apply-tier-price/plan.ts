export type Interval = 'month' | 'year';

/** Adds one billing interval to a unix timestamp (seconds). */
export function addInterval(unix: number, interval: Interval): number {
  const d = new Date(unix * 1000);
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return Math.floor(d.getTime() / 1000);
}

/** The first renewal (from the current period end) that's at or after the cutoff. */
export function firstRenewalAfter(periodEnd: number, interval: Interval, cutoff: number): number {
  let t = periodEnd;
  while (t < cutoff) t = addInterval(t, interval);
  return t;
}
