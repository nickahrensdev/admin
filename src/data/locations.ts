import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { safeError } from '../lib/errors';
import { hhmm } from '../utils/time';

export type ResourceType = 'batting_cage' | 'turf';

export const RESOURCE_TYPES: { value: ResourceType; label: string; plural: string }[] = [
  { value: 'batting_cage', label: 'Batting cage', plural: 'Batting cages' },
  { value: 'turf', label: 'Turf', plural: 'Turf' },
];

export function resourceTypeLabel(t: ResourceType): string {
  return RESOURCE_TYPES.find((r) => r.value === t)?.label ?? t;
}

export interface Location {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  address: string | null;
  is_active: boolean;
}

export interface Resource {
  id: string;
  location_id: string;
  type: ResourceType;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface DayHours {
  weekday: number;
  is_closed: boolean;
  opens_at: string; // "HH:MM"
  closes_at: string;
}

export interface PeakDay {
  weekday: number;
  enabled: boolean;
  starts_at: string;
  ends_at: string;
}

export interface Closure {
  id: string;
  date: string; // YYYY-MM-DD
  all_day: boolean;
  opens_at: string | null;
  closes_at: string | null;
  reason: string;
}

export interface Price {
  resource_type: ResourceType;
  base_cents: number;
  peak_cents: number | null;
}

function check<T>(res: { data: T; error: PostgrestError | null }): T {
  if (res.error) {
    if (res.error.code === '23505') throw new Error('That already exists.');
    if (res.error.code === '42501') throw new Error("You don't have permission to do that.");
    throw safeError(res.error);
  }
  return res.data;
}

/* ---------------- Locations ---------------- */

export async function listLocations(): Promise<Location[]> {
  return check(
    await supabase.from('locations').select('id, slug, name, timezone, address, is_active').order('created_at'),
  ) as Location[];
}

export async function getLocation(id: string): Promise<Location | null> {
  return check(
    await supabase.from('locations').select('id, slug, name, timezone, address, is_active').eq('id', id).maybeSingle(),
  ) as Location | null;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export async function createLocation(input: { name: string; address?: string; timezone?: string }): Promise<Location> {
  const name = input.name.trim();
  if (!name) throw new Error('Name is required.');
  const slug = slugify(name) || `location-${Date.now()}`;
  return check(
    await supabase
      .from('locations')
      .insert({ name, slug, address: input.address?.trim() || null, timezone: input.timezone ?? 'America/Chicago' })
      .select('id, slug, name, timezone, address, is_active')
      .single(),
  ) as Location;
}

export async function updateLocation(
  id: string,
  patch: Partial<Pick<Location, 'name' | 'address' | 'timezone' | 'is_active'>>,
): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('Name is required.');
  check(await supabase.from('locations').update(patch).eq('id', id));
}

/* ---------------- Resources ---------------- */

export async function listResources(locationId: string): Promise<Resource[]> {
  return check(
    await supabase
      .from('resources')
      .select('id, location_id, type, name, sort_order, is_active')
      .eq('location_id', locationId)
      .order('sort_order')
      .order('name'),
  ) as Resource[];
}

export async function addResource(locationId: string, type: ResourceType, name: string, sortOrder: number) {
  if (!name.trim()) throw new Error('Name is required.');
  check(
    await supabase.from('resources').insert({ location_id: locationId, type, name: name.trim(), sort_order: sortOrder }),
  );
}

export async function updateResource(id: string, patch: Partial<Pick<Resource, 'name' | 'is_active' | 'sort_order'>>) {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('Name is required.');
  check(await supabase.from('resources').update(patch).eq('id', id));
}

/* ---------------- Weekly hours ---------------- */

export async function getHours(locationId: string): Promise<DayHours[]> {
  const rows = check(
    await supabase.from('location_hours').select('weekday, is_closed, opens_at, closes_at').eq('location_id', locationId),
  ) as { weekday: number; is_closed: boolean; opens_at: string | null; closes_at: string | null }[];
  return Array.from({ length: 7 }, (_, weekday) => {
    const r = rows.find((x) => x.weekday === weekday);
    return {
      weekday,
      is_closed: r?.is_closed ?? true,
      opens_at: hhmm(r?.opens_at) || '09:00',
      closes_at: hhmm(r?.closes_at) || '17:00',
    };
  });
}

export function validateHours(days: DayHours[]): string | null {
  for (const d of days) {
    if (!d.is_closed && d.closes_at <= d.opens_at) return 'Closing time must be after opening time.';
  }
  return null;
}

export async function saveHours(locationId: string, days: DayHours[]) {
  const problem = validateHours(days);
  if (problem) throw new Error(problem);
  check(
    await supabase.from('location_hours').upsert(
      days.map((d) => ({
        location_id: locationId,
        weekday: d.weekday,
        is_closed: d.is_closed,
        opens_at: d.is_closed ? null : d.opens_at,
        closes_at: d.is_closed ? null : d.closes_at,
      })),
    ),
  );
}

/* ---------------- Peak hours ---------------- */

export async function getPeak(locationId: string): Promise<PeakDay[]> {
  const rows = check(
    await supabase.from('location_peak_hours').select('weekday, starts_at, ends_at').eq('location_id', locationId),
  ) as { weekday: number; starts_at: string; ends_at: string }[];
  return Array.from({ length: 7 }, (_, weekday) => {
    const r = rows.find((x) => x.weekday === weekday);
    return { weekday, enabled: Boolean(r), starts_at: hhmm(r?.starts_at) || '14:00', ends_at: hhmm(r?.ends_at) || '20:00' };
  });
}

export async function savePeak(locationId: string, days: PeakDay[]) {
  for (const d of days) {
    if (d.enabled && d.ends_at <= d.starts_at) throw new Error('Peak end time must be after the start time.');
  }
  const off = days.filter((d) => !d.enabled).map((d) => d.weekday);
  const on = days.filter((d) => d.enabled);
  if (off.length) {
    check(await supabase.from('location_peak_hours').delete().eq('location_id', locationId).in('weekday', off));
  }
  if (on.length) {
    check(
      await supabase.from('location_peak_hours').upsert(
        on.map((d) => ({ location_id: locationId, weekday: d.weekday, starts_at: d.starts_at, ends_at: d.ends_at })),
      ),
    );
  }
}

/* ---------------- Prices ---------------- */

export async function getPrices(locationId: string): Promise<Price[]> {
  const rows = check(
    await supabase.from('resource_prices').select('resource_type, base_cents, peak_cents').eq('location_id', locationId),
  ) as Price[];
  return RESOURCE_TYPES.map(
    (t) => rows.find((r) => r.resource_type === t.value) ?? { resource_type: t.value, base_cents: 0, peak_cents: null },
  );
}

export async function savePrices(locationId: string, prices: Price[]) {
  check(
    await supabase
      .from('resource_prices')
      .upsert(prices.map((p) => ({ location_id: locationId, ...p }))),
  );
}

/* ---------------- Closures ---------------- */

export async function listClosures(locationId: string, fromDate: string): Promise<Closure[]> {
  const rows = check(
    await supabase
      .from('location_closures')
      .select('id, date, all_day, opens_at, closes_at, reason')
      .eq('location_id', locationId)
      .gte('date', fromDate)
      .order('date'),
  ) as Closure[];
  return rows.map((r) => ({ ...r, opens_at: hhmm(r.opens_at) || null, closes_at: hhmm(r.closes_at) || null }));
}

export async function addClosures(
  locationId: string,
  closures: { date: string; all_day: boolean; opens_at?: string | null; closes_at?: string | null; reason: string }[],
) {
  for (const c of closures) {
    if (!c.date) throw new Error('Pick a date.');
    if (!c.all_day && (!c.opens_at || !c.closes_at || c.closes_at <= c.opens_at)) {
      throw new Error('Special hours need a closing time after the opening time.');
    }
  }
  const res = await supabase.from('location_closures').insert(
    closures.map((c) => ({
      location_id: locationId,
      date: c.date,
      all_day: c.all_day,
      opens_at: c.all_day ? null : c.opens_at,
      closes_at: c.all_day ? null : c.closes_at,
      reason: c.reason.trim().slice(0, 80),
    })),
  );
  if (res.error?.code === '23505') throw new Error('There is already a closure on that date.');
  check(res);
}

export async function deleteClosure(id: string) {
  check(await supabase.from('location_closures').delete().eq('id', id));
}
