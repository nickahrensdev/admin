import { getHours, getPeak, getPrices, listLocations, listResources } from './locations';
import { adminListMembers, listTiers } from './memberships';
import { reportSummary } from './reports';
import { addDays, todayIn } from '../utils/dates';
import { monthlyHours, type LocationBase, type TierBase } from '../utils/projection';

/** Starting guesses when a location has no booking history yet. */
const GUESS = { cagePeak: 0.5, cageOff: 0.2, turf: 0.3 };

/**
 * Everything the projection needs, from live data: each active location's
 * cages, hours, prices and last-30-day occupancy, and each tier's price,
 * benefits and active member count.
 */
export async function loadProjectionBase(): Promise<{ locations: LocationBase[]; tiers: TierBase[] }> {
  const locs = (await listLocations()).filter((l) => l.is_active);
  const [tiers, members] = await Promise.all([listTiers(), adminListMembers().catch(() => [])]);

  const locations = await Promise.all(
    locs.map(async (l): Promise<LocationBase> => {
      const today = todayIn(l.timezone);
      const [resources, hours, peak, prices, report] = await Promise.all([
        listResources(l.id),
        getHours(l.id),
        getPeak(l.id),
        getPrices(l.id),
        reportSummary(addDays(today, -30), addDays(today, -1), l.id).catch(() => null),
      ]);
      const active = resources.filter((r) => r.is_active);
      const price = (t: 'batting_cage' | 'turf') => {
        const p = prices.find((x) => x.resource_type === t);
        return { off: p?.base_cents ?? 0, peak: p?.peak_cents ?? p?.base_cents ?? 0 };
      };
      const { peakHours, offHours } = monthlyHours(hours, peak);

      // Occupancy from the last 30 days: per type overall, split peak/off by the hour-of-day pattern.
      let occ = { ...GUESS };
      let fromData = false;
      if (report) {
        const u = (t: 'batting_cage' | 'turf') => report.utilization.find((x) => x.type === t);
        const cage = u('batting_cage');
        const turf = u('turf');
        const isPeak = (h: number) =>
          peak.some((p) => p.enabled && Number(p.starts_at.slice(0, 2)) <= h && h < Number(p.ends_at.slice(0, 2)));
        const sum = (f: (x: { hour: number }) => boolean, k: 'open_slots' | 'booked_slots') =>
          report.by_hour.filter(f).reduce((s, x) => s + x[k], 0);
        const allOpen = sum(() => true, 'open_slots');
        const allBooked = sum(() => true, 'booked_slots');
        if (cage && cage.open_hours > 0 && cage.booked_hours > 0 && allOpen > 0 && allBooked > 0) {
          const overall = allBooked / allOpen;
          const pOpen = sum((x) => isPeak(x.hour), 'open_slots');
          const oOpen = allOpen - pOpen;
          const pRate = pOpen ? sum((x) => isPeak(x.hour), 'booked_slots') / pOpen : overall;
          const oRate = oOpen ? sum((x) => !isPeak(x.hour), 'booked_slots') / oOpen : overall;
          const cageOcc = cage.booked_hours / cage.open_hours;
          occ = {
            cagePeak: Math.min(1, cageOcc * (pRate / overall)),
            cageOff: Math.min(1, cageOcc * (oRate / overall)),
            turf: turf && turf.open_hours > 0 ? turf.booked_hours / turf.open_hours : 0,
          };
          fromData = true;
        }
      }
      return {
        id: l.id,
        name: l.name,
        cages: active.filter((r) => r.type === 'batting_cage').length,
        turfs: active.filter((r) => r.type === 'turf').length,
        peakHours,
        offHours,
        cagePrice: price('batting_cage'),
        turfPrice: price('turf'),
        occ,
        occFromData: fromData,
      };
    }),
  );

  const live = members.filter((m) => m.status === 'active' || m.status === 'past_due');
  const tierBases: TierBase[] = tiers.map((t) => ({
    id: t.id,
    name: t.name,
    scope: t.scope,
    locationId: t.location?.id ?? null,
    priceCents: t.monthly_price_cents,
    members: live.filter((m) => m.tier_name === t.name).length,
    benefits: Object.fromEntries(
      t.benefits.map((b) => [b.location_id, { includedMin: b.included_cage_minutes, cageDisc: b.cage_discount_pct, turfDisc: b.turf_discount_pct }]),
    ),
  }));
  return { locations, tiers: tierBases };
}
