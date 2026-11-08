/**
 * Monthly profit projection for the admin Projections page. Pure functions,
 * so the page (and the tests) can recompute on every slider move.
 *
 * Money is in cents. Prices are per 30 minutes, like the rest of the app.
 */

export const WEEKS_PER_MONTH = 365 / 7 / 12;

export interface LocationBase {
  id: string;
  name: string;
  cages: number;
  turfs: number;
  /** Open hours per month for ONE resource, split into peak and off-peak. */
  peakHours: number;
  offHours: number;
  cagePrice: { off: number; peak: number };
  turfPrice: { off: number; peak: number };
  /** Occupancy (0–1) at today's prices. */
  occ: { cagePeak: number; cageOff: number; turf: number };
  /** True when occ came from real bookings, false when it's a starting guess. */
  occFromData: boolean;
}

export interface TierBase {
  id: string;
  name: string;
  scope: 'location' | 'all';
  locationId: string | null;
  priceCents: number;
  members: number;
  /** Benefits per location id. */
  benefits: Record<string, { includedMin: number; cageDisc: number; turfDisc: number }>;
}

export interface LocationLevers {
  cagePriceMult: number;
  turfPriceMult: number;
  /** Occupancy percentages (0–100) at today's prices. */
  occCagePeak: number;
  occCageOff: number;
  occTurf: number;
  fixedCents: number;
  varCentsPerHour: number;
}

export interface TierLevers {
  members: number;
  priceCents: number;
  includedMin: number;
}

export interface GlobalLevers {
  /** % fewer bookings per 1% price rise (0.5 = a 10% raise loses 5% of bookings). */
  elasticity: number;
  /** % of included time members actually use. */
  includedUse: number;
  /** % of paid cage/turf hours booked by members (they get their discount). */
  memberShare: number;
  /** Card processing, % of revenue. */
  feePct: number;
}

export interface Scenario {
  global: GlobalLevers;
  tiers: Record<string, TierLevers>;
  locs: Record<string, LocationLevers>;
}

export interface Result {
  cageHours: number;
  turfHours: number;
  includedHours: number;
  /** Bookable cage + turf hours in the month. */
  capacityHours: number;
  /** Booked share of cage + turf capacity (0–1). */
  occupancy: number;
  members: number;
  revenue: { cage: number; turf: number; memberships: number; total: number };
  costs: { fees: number; variable: number; fixed: number; total: number };
  profit: number;
}

export const DEFAULT_GLOBAL: GlobalLevers = { elasticity: 1, includedUse: 75, memberShare: 30, feePct: 3 };

export function defaultLevers(l: LocationBase): LocationLevers {
  return {
    cagePriceMult: 1,
    turfPriceMult: 1,
    occCagePeak: Math.round(l.occ.cagePeak * 100),
    occCageOff: Math.round(l.occ.cageOff * 100),
    occTurf: Math.round(l.occ.turf * 100),
    fixedCents: 0,
    varCentsPerHour: 0,
  };
}

export function defaultScenario(locs: LocationBase[], tiers: TierBase[]): Scenario {
  return {
    global: { ...DEFAULT_GLOBAL },
    tiers: Object.fromEntries(
      tiers.map((t) => {
        const mins = Object.values(t.benefits).map((b) => b.includedMin);
        return [t.id, { members: t.members, priceCents: t.priceCents, includedMin: mins.length ? Math.max(...mins) : 0 }];
      }),
    ),
    locs: Object.fromEntries(locs.map((l) => [l.id, defaultLevers(l)])),
  };
}

/** Hours of [a,b) that overlap [c,d), with times as "HH:MM". */
function overlapHours(a: string, b: string, c: string, d: string): number {
  const m = (t: string) => {
    const [h, mm] = t.split(':').map(Number);
    return h * 60 + mm;
  };
  return Math.max(0, Math.min(m(b), m(d)) - Math.max(m(a), m(c))) / 60;
}

/** Monthly peak/off-peak open hours for one resource from the weekly schedule. */
export function monthlyHours(
  week: { weekday: number; is_closed: boolean; opens_at: string; closes_at: string }[],
  peak: { weekday: number; enabled: boolean; starts_at: string; ends_at: string }[],
): { peakHours: number; offHours: number } {
  let peakH = 0;
  let total = 0;
  for (const d of week) {
    if (d.is_closed) continue;
    const open = overlapHours(d.opens_at, d.closes_at, '00:00', '24:00');
    total += open;
    const p = peak.find((x) => x.weekday === d.weekday);
    if (p?.enabled) peakH += overlapHours(d.opens_at, d.closes_at, p.starts_at, p.ends_at);
  }
  return { peakHours: peakH * WEEKS_PER_MONTH, offHours: (total - peakH) * WEEKS_PER_MONTH };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Demand after a price change: fewer bookings when prices go up, more when down. */
export function adjustedOcc(occPct: number, priceMult: number, elasticity: number): number {
  return clamp01((occPct / 100) * (1 - elasticity * (priceMult - 1)));
}

/** How much of a tier's membership a location carries: all of a local tier, an even share of an all-locations tier. */
function share(t: TierBase, locId: string, nLocs: number): number {
  if (t.scope === 'all') return nLocs ? 1 / nLocs : 0;
  return t.locationId === locId ? 1 : 0;
}

/**
 * One location's month. `occScale` multiplies every occupancy (used for the
 * break-even search); `cageMultOverride` replaces the cage price lever (used
 * for the best-price sweep).
 */
export function projectLocation(
  l: LocationBase,
  tiers: TierBase[],
  s: Scenario,
  nLocs: number,
  opts: { occScale?: number; cageMultOverride?: number } = {},
): Result {
  const lv = s.locs[l.id] ?? defaultLevers(l);
  const g = s.global;
  const k = opts.occScale ?? 1;
  const cageMult = opts.cageMultOverride ?? lv.cagePriceMult;

  const occPeak = clamp01(adjustedOcc(lv.occCagePeak, cageMult, g.elasticity) * k);
  const occOff = clamp01(adjustedOcc(lv.occCageOff, cageMult, g.elasticity) * k);
  const occTurf = clamp01(adjustedOcc(lv.occTurf, lv.turfPriceMult, g.elasticity) * k);

  const cagePeakH = l.cages * l.peakHours * occPeak;
  const cageOffH = l.cages * l.offHours * occOff;
  const turfPeakH = l.turfs * l.peakHours * occTurf;
  const turfOffH = l.turfs * l.offHours * occTurf;
  const cageH = cagePeakH + cageOffH;
  const turfH = turfPeakH + turfOffH;

  // Members and their benefits at this location.
  let members = 0;
  let membershipRev = 0;
  let includedH = 0;
  let cageDiscW = 0;
  let turfDiscW = 0;
  for (const t of tiers) {
    const f = share(t, l.id, nLocs);
    const b = t.benefits[l.id];
    if (!f || !b) continue;
    const tl = s.tiers[t.id] ?? { members: t.members, priceCents: t.priceCents, includedMin: b.includedMin };
    const m = tl.members * f;
    members += m;
    membershipRev += m * tl.priceCents;
    includedH += (m * tl.includedMin * (g.includedUse / 100)) / 60;
    cageDiscW += m * b.cageDisc;
    turfDiscW += m * b.turfDisc;
  }
  const cageDisc = members ? cageDiscW / members / 100 : 0;
  const turfDisc = members ? turfDiscW / members / 100 : 0;

  // Included time fills booked cage hours first (it isn't paid for).
  const usedIncluded = Math.min(includedH, cageH);
  const paidShare = cageH ? (cageH - usedIncluded) / cageH : 0;
  const ms = g.memberShare / 100;
  const cageRev =
    (cagePeakH * l.cagePrice.peak + cageOffH * l.cagePrice.off) * 2 * cageMult * paidShare * (1 - (members ? ms * cageDisc : 0));
  const turfRev = (turfPeakH * l.turfPrice.peak + turfOffH * l.turfPrice.off) * 2 * lv.turfPriceMult * (1 - (members ? ms * turfDisc : 0));

  const total = cageRev + turfRev + membershipRev;
  const fees = total * (g.feePct / 100);
  const variable = (cageH + turfH) * lv.varCentsPerHour;
  const fixed = lv.fixedCents;
  const capacity = (l.cages + l.turfs) * (l.peakHours + l.offHours);

  return {
    cageHours: cageH,
    turfHours: turfH,
    includedHours: usedIncluded,
    capacityHours: capacity,
    occupancy: capacity ? (cageH + turfH) / capacity : 0,
    members,
    revenue: { cage: cageRev, turf: turfRev, memberships: membershipRev, total },
    costs: { fees, variable, fixed, total: fees + variable + fixed },
    profit: total - fees - variable - fixed,
  };
}

export function sumResults(rs: Result[]): Result {
  const z: Result = {
    cageHours: 0,
    turfHours: 0,
    includedHours: 0,
    capacityHours: 0,
    occupancy: 0,
    members: 0,
    revenue: { cage: 0, turf: 0, memberships: 0, total: 0 },
    costs: { fees: 0, variable: 0, fixed: 0, total: 0 },
    profit: 0,
  };
  for (const r of rs) {
    z.cageHours += r.cageHours;
    z.turfHours += r.turfHours;
    z.includedHours += r.includedHours;
    z.capacityHours += r.capacityHours;
    z.members += r.members;
    z.revenue.cage += r.revenue.cage;
    z.revenue.turf += r.revenue.turf;
    z.revenue.memberships += r.revenue.memberships;
    z.revenue.total += r.revenue.total;
    z.costs.fees += r.costs.fees;
    z.costs.variable += r.costs.variable;
    z.costs.fixed += r.costs.fixed;
    z.costs.total += r.costs.total;
    z.profit += r.profit;
  }
  z.occupancy = z.capacityHours ? (z.cageHours + z.turfHours) / z.capacityHours : 0;
  return z;
}

/** Projects the chosen locations (all of them, or one). */
export function project(
  locs: LocationBase[],
  tiers: TierBase[],
  s: Scenario,
  opts: { occScale?: number; cageMultOverride?: number } = {},
): { total: Result; byLocation: { loc: LocationBase; result: Result }[] } {
  const n = locs.length;
  const byLocation = locs.map((loc) => ({ loc, result: projectLocation(loc, tiers, s, n, opts) }));
  return { total: sumResults(byLocation.map((x) => x.result)), byLocation };
}

export interface SweepPoint {
  mult: number;
  profit: number;
}

/** Profit across cage price levels (0.5× to 2×), and the best one. */
export function priceSweep(
  locs: LocationBase[],
  allLocs: LocationBase[],
  tiers: TierBase[],
  s: Scenario,
): { points: SweepPoint[]; best: SweepPoint } {
  const n = allLocs.length;
  const points: SweepPoint[] = [];
  for (let m = 0.5; m <= 2.0001; m += 0.05) {
    const mult = Math.round(m * 100) / 100;
    const profit = locs.reduce((sum, l) => sum + projectLocation(l, tiers, s, n, { cageMultOverride: mult }).profit, 0);
    points.push({ mult, profit });
  }
  const best = points.reduce((a, b) => (b.profit > a.profit + 0.5 ? b : a));
  return { points, best };
}

/**
 * Occupancy needed to break even, scaling every occupancy lever together.
 * 'always' = memberships cover the costs on their own; 'never' = not even full
 * cages get there at these prices.
 */
export function breakEven(locs: LocationBase[], allLocs: LocationBase[], tiers: TierBase[], s: Scenario): number | 'always' | 'never' {
  const n = allLocs.length;
  const at = (k: number) => {
    const rs = locs.map((l) => projectLocation(l, tiers, s, n, { occScale: k }));
    return sumResults(rs);
  };
  if (at(0).profit >= 0) return 'always';
  // Largest scale that matters: the one that fills the fullest lever.
  const maxPct = Math.max(1, ...locs.map((l) => Math.max(s.locs[l.id]?.occCagePeak ?? 0, s.locs[l.id]?.occCageOff ?? 0, s.locs[l.id]?.occTurf ?? 0)));
  let hi = 100 / maxPct;
  // Scaling can't push past 100%, so try "everything full" for the upper bound.
  if (at(hi).profit < 0) {
    const full = sumResults(
      locs.map((l) =>
        projectLocation(l, tiers, { ...s, locs: { ...s.locs, [l.id]: { ...s.locs[l.id], occCagePeak: 100, occCageOff: 100, occTurf: 100 } } }, n),
      ),
    );
    if (full.profit < 0) return 'never';
    hi = 1e3; // clamp01 keeps occupancy at 100%
  }
  let lo = 0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid).profit >= 0) hi = mid;
    else lo = mid;
  }
  return at(hi).occupancy;
}
