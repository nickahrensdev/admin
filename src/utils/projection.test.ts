import { describe, expect, it } from 'vitest';
import {
  WEEKS_PER_MONTH, adjustedOcc, breakEven, defaultScenario, monthlyHours, priceSweep, project, projectLocation,
  type LocationBase, type TierBase,
} from './projection';

const loc = (over: Partial<LocationBase> = {}): LocationBase => ({
  id: 'L1',
  name: 'Location 1',
  cages: 2,
  turfs: 0,
  peakHours: 100,
  offHours: 100,
  cagePrice: { off: 2000, peak: 2500 },
  turfPrice: { off: 4500, peak: 5500 },
  occ: { cagePeak: 0.5, cageOff: 0.25, turf: 0 },
  occFromData: false,
  ...over,
});

const rookie: TierBase = {
  id: 'T1', name: 'Rookie', scope: 'location', locationId: 'L1', priceCents: 4900, members: 10,
  benefits: { L1: { includedMin: 240, cageDisc: 10, turfDisc: 10 } },
};

describe('monthlyHours', () => {
  it('splits each open day into peak and off-peak hours', () => {
    const week = [{ weekday: 1, is_closed: false, opens_at: '09:00', closes_at: '21:00' }, { weekday: 0, is_closed: true, opens_at: '09:00', closes_at: '17:00' }];
    const peak = [{ weekday: 1, enabled: true, starts_at: '14:00', ends_at: '20:00' }];
    const h = monthlyHours(week, peak);
    expect(h.peakHours).toBeCloseTo(6 * WEEKS_PER_MONTH);
    expect(h.offHours).toBeCloseTo(6 * WEEKS_PER_MONTH);
  });
});

describe('projectLocation', () => {
  it('prices booked hours at peak and off-peak rates (per 30 min)', () => {
    const l = loc();
    const s = defaultScenario([l], []);
    s.global.feePct = 0;
    const r = projectLocation(l, [], s, 1);
    // peak: 2 cages × 100 h × 50% × $50/h = $5,000; off: 2 × 100 × 25% × $40/h = $2,000
    expect(r.revenue.cage).toBeCloseTo(700_000);
    expect(r.cageHours).toBeCloseTo(150);
    expect(r.profit).toBeCloseTo(700_000);
  });

  it('counts membership fees, removes used included time, and applies member discounts', () => {
    const l = loc();
    const s = defaultScenario([l], [rookie]);
    s.global = { elasticity: 0, includedUse: 100, memberShare: 0, feePct: 0 };
    const r = projectLocation(l, [rookie], s, 1);
    expect(r.revenue.memberships).toBe(49_000);
    expect(r.includedHours).toBeCloseTo(40); // 10 members × 4 h
    expect(r.revenue.cage).toBeCloseTo(700_000 * (110 / 150));

    s.global.memberShare = 100;
    expect(projectLocation(l, [rookie], s, 1).revenue.cage).toBeCloseTo(700_000 * (110 / 150) * 0.9);
  });

  it('takes card fees and costs off the profit', () => {
    const l = loc();
    const s = defaultScenario([l], []);
    s.global.feePct = 3;
    s.locs.L1.fixedCents = 100_000;
    s.locs.L1.varCentsPerHour = 200;
    const r = projectLocation(l, [], s, 1);
    expect(r.costs.fees).toBeCloseTo(21_000);
    expect(r.costs.variable).toBeCloseTo(30_000);
    expect(r.profit).toBeCloseTo(700_000 - 21_000 - 30_000 - 100_000);
  });

  it('splits an all-locations tier evenly across locations', () => {
    const a = loc({ id: 'A' });
    const b = loc({ id: 'B' });
    const allStar: TierBase = {
      id: 'T2', name: 'All-Star', scope: 'all', locationId: null, priceCents: 9900, members: 10,
      benefits: { A: { includedMin: 0, cageDisc: 0, turfDisc: 0 }, B: { includedMin: 0, cageDisc: 0, turfDisc: 0 } },
    };
    const s = defaultScenario([a, b], [allStar]);
    const { byLocation, total } = project([a, b], [allStar], s);
    expect(byLocation[0].result.revenue.memberships).toBe(49_500);
    expect(total.revenue.memberships).toBe(99_000);
  });
});

describe('demand and optimizing', () => {
  it('loses bookings when prices rise, gains them when prices drop', () => {
    expect(adjustedOcc(50, 1.2, 0.5)).toBeCloseTo(0.45);
    expect(adjustedOcc(50, 0.8, 0.5)).toBeCloseTo(0.55);
    expect(adjustedOcc(90, 0.5, 2)).toBe(1);
    expect(adjustedOcc(50, 2, 2)).toBe(0);
  });

  it('finds the most profitable cage price', () => {
    const l = loc();
    const s = defaultScenario([l], []);
    s.global.elasticity = 1; // revenue ∝ m(2 − m), best at 1×
    expect(priceSweep([l], [l], [], s).best.mult).toBe(1);
    s.global.elasticity = 0; // no lost bookings: the highest price wins
    expect(priceSweep([l], [l], [], s).best.mult).toBe(2);
  });

  it('finds break-even occupancy', () => {
    const l = loc();
    const s = defaultScenario([l], []);
    s.global.feePct = 0;
    s.locs.L1.fixedCents = 350_000; // half of the revenue at today's occupancy
    const be = breakEven([l], [l], [], s);
    expect(typeof be).toBe('number');
    expect(be as number).toBeCloseTo(0.375 / 2, 2); // today's 37.5% average, halved

    s.locs.L1.fixedCents = 0;
    expect(breakEven([l], [l], [], s)).toBe('always');
    s.locs.L1.fixedCents = 10_000_000;
    expect(breakEven([l], [l], [], s)).toBe('never');
  });
});
