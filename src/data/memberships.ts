import { FunctionsHttpError, type PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface TierBenefit {
  location_id: string;
  location_name: string;
  included_cage_minutes: number;
  cage_discount_pct: number;
  turf_discount_pct: number;
  booking_window_days: number;
  max_upcoming_bookings: number | null;
}

export interface Tier {
  id: string;
  name: string;
  description: string;
  scope: 'location' | 'all';
  location: { id: string; name: string } | null;
  monthly_price_cents: number;
  yearly_price_cents: number | null;
  benefits: TierBenefit[];
}

export interface MyMembership {
  id: string;
  status: 'incomplete' | 'active' | 'past_due' | 'canceled';
  billing_interval: 'month' | 'year';
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  tier: { id: string; name: string; scope: 'location' | 'all'; location_name: string | null };
}

export interface Member {
  id: string;
  status: string;
  billing_interval: 'month' | 'year';
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  tier_name: string;
  display_name: string;
  username: string;
  email: string;
}

/** Editable tier row (admin). */
export interface TierRow {
  id: string;
  name: string;
  description: string;
  scope: 'location' | 'all';
  location_id: string | null;
  monthly_price_cents: number;
  yearly_price_cents: number | null;
  is_active: boolean;
  sort_order: number;
}

export interface BenefitRow {
  tier_id: string;
  location_id: string;
  included_cage_minutes: number;
  cage_discount_pct: number;
  turf_discount_pct: number;
  booking_window_days: number;
  max_upcoming_bookings: number | null;
}

function check<T>(res: { data: T; error: PostgrestError | null }): T {
  if (res.error) {
    if (res.error.code === '42501') throw new Error("You don't have permission to do that.");
    if (res.error.code === '23514') throw new Error('Check the values: prices must be at least $0.50 and percentages 0–100.');
    throw new Error(res.error.message);
  }
  return res.data;
}

async function fnError(error: unknown, fallback: string) {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return new Error(body.error);
    } catch {
      /* ignore */
    }
  }
  return new Error(fallback);
}

export async function listTiers(): Promise<Tier[]> {
  return (check(await supabase.rpc('list_membership_tiers')) ?? []) as Tier[];
}

export async function myMembership(): Promise<MyMembership | null> {
  return (check(await supabase.rpc('my_membership')) ?? null) as MyMembership | null;
}

/** Returns the Stripe Checkout URL for a subscription. */
export async function joinMembership(tierId: string, interval: 'month' | 'year'): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>('create-membership-checkout', {
    body: { tier_id: tierId, interval },
  });
  if (error) throw await fnError(error, 'Could not start checkout. Please try again.');
  if (!data?.url) throw new Error('Could not start checkout. Please try again.');
  return data.url;
}

/** Returns the Stripe customer portal URL. */
export async function openBillingPortal(): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>('billing-portal', { body: {} });
  if (error) throw await fnError(error, 'Could not open billing. Please try again.');
  if (!data?.url) throw new Error('Could not open billing. Please try again.');
  return data.url;
}

/* ---------------- Admin ---------------- */

export async function adminListMembers(): Promise<Member[]> {
  return (check(await supabase.rpc('admin_list_members')) ?? []) as Member[];
}

export async function adminListTiers(): Promise<TierRow[]> {
  return check(
    await supabase
      .from('membership_tiers')
      .select('id, name, description, scope, location_id, monthly_price_cents, yearly_price_cents, is_active, sort_order')
      .order('sort_order')
      .order('monthly_price_cents'),
  ) as TierRow[];
}

export async function adminGetBenefits(tierId: string): Promise<BenefitRow[]> {
  return check(
    await supabase
      .from('tier_location_benefits')
      .select('tier_id, location_id, included_cage_minutes, cage_discount_pct, turf_discount_pct, booking_window_days, max_upcoming_bookings')
      .eq('tier_id', tierId),
  ) as BenefitRow[];
}

export async function adminSaveTier(tier: Omit<TierRow, 'id'> & { id?: string }): Promise<string> {
  if (!tier.name.trim()) throw new Error('Name is required.');
  if (tier.scope === 'location' && !tier.location_id) throw new Error('Pick the location this tier is for.');
  const row = {
    name: tier.name.trim(),
    description: tier.description.trim(),
    scope: tier.scope,
    location_id: tier.scope === 'location' ? tier.location_id : null,
    monthly_price_cents: tier.monthly_price_cents,
    yearly_price_cents: tier.yearly_price_cents,
    is_active: tier.is_active,
    sort_order: tier.sort_order,
  };
  if (tier.id) {
    check(await supabase.from('membership_tiers').update(row).eq('id', tier.id));
    return tier.id;
  }
  const created = check(await supabase.from('membership_tiers').insert(row).select('id').single()) as { id: string };
  return created.id;
}

export async function adminSaveBenefits(rows: BenefitRow[]) {
  for (const r of rows) {
    if (r.included_cage_minutes % 30 !== 0) throw new Error('Included cage time must be in 30-minute steps.');
  }
  check(await supabase.from('tier_location_benefits').upsert(rows));
}
