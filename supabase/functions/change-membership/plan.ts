export type Interval = 'month' | 'year';

export interface ChangeInput {
  sameTier: boolean;
  currentMonthlyCents: number;
  nextMonthlyCents: number;
  /** What the member pays now for their current interval. */
  oldPriceCents: number;
  /** The new plan's price for the chosen interval. */
  newPriceCents: number;
  currentInterval: Interval;
  nextInterval: Interval;
  periodStart: string | null;
  periodEnd: string | null;
  now?: number;
}

/**
 * Decides how a plan change happens.
 *  * Higher tier, or the same tier monthly → yearly: immediate (charged now).
 *  * Lower tier, or yearly → monthly: at the next renewal.
 * estimate: what an immediate switch would cost today (negative = a credit).
 */
export function planChange(i: ChangeInput): { immediate: boolean; estimate: number } {
  const now = i.now ?? Date.now();
  const start = i.periodStart ? Date.parse(i.periodStart) : now;
  const end = i.periodEnd ? Date.parse(i.periodEnd) : now;
  const left = end > start ? Math.min(1, Math.max(0, (end - now) / (end - start))) : 0;
  const intervalChanges = i.nextInterval !== i.currentInterval;
  // A new billing interval starts a fresh period today; otherwise only the rest of this period changes.
  const estimate = intervalChanges
    ? i.newPriceCents - Math.round(i.oldPriceCents * left)
    : Math.round((i.newPriceCents - i.oldPriceCents) * left);
  const immediate = i.sameTier ? i.nextInterval === 'year' : i.nextMonthlyCents > i.currentMonthlyCents;
  return { immediate, estimate };
}
