import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { safeError } from '../lib/errors';
import type { ResourceType } from './locations';

export interface Slot {
  starts_at: string; // ISO timestamp
  time: string; // "HH:MM" local to the location
  peak: boolean;
  past: boolean;
  free: string[]; // resource ids free for this 30 minutes
}

export interface Availability {
  location_id: string;
  date: string;
  timezone: string;
  closed: boolean;
  closed_reason: string | null;
  resources: { id: string; name: string; type: ResourceType }[];
  prices: { type: ResourceType; base_cents: number; peak_cents: number | null }[];
  slots: Slot[];
}

export interface BookingTerms {
  member: boolean;
  booking_window_days: number;
  tier_name?: string;
  included_cage_minutes?: number;
  included_used_this_month?: number;
  cage_discount_pct?: number;
  turf_discount_pct?: number;
  max_upcoming_bookings?: number | null;
}

export interface Quote {
  member: { membership_id: string; tier_name: string } | null;
  total_cents: number;
  discount_cents: number;
  dates: {
    starts_at: string;
    ends_at: string;
    total_cents: number;
    discount_cents: number;
    included_minutes: number;
    items: { resource_id: string; name: string; list_cents: number; price_cents: number; included_minutes: number }[];
  }[];
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface MyBooking {
  id: string;
  /** 'online' (booked here) or 'walk_in' (booked by staff at the desk). */
  kind?: 'online' | 'walk_in';
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  total_cents: number;
  refund_cents: number;
  hold_expires_at: string | null;
  created_at: string;
  location: { id: string; name: string; timezone: string; address?: string | null };
  discount_cents?: number;
  items: { resource_id?: string; name: string; type: ResourceType; price_cents: number; included_minutes?: number }[] | null;
}

export function rpcError(error: { message: string; code?: string }): Error {
  if (error.code === '42501' && /sign in/i.test(error.message)) return new Error('Please sign in to book.');
  return safeError(error);
}

export async function functionError(error: unknown, fallback: string): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return new Error(body.error);
    } catch {
      /* fall through */
    }
  }
  return new Error(fallback);
}

export async function getAvailability(locationId: string, date: string): Promise<Availability> {
  const { data, error } = await supabase.rpc('get_availability', { p_location: locationId, p_date: date });
  if (error) throw rpcError(error);
  return data as Availability;
}

/** Holds the same cages and time on one or more dates; all are paid in one checkout. */
export async function createHolds(locationId: string, resourceIds: string[], slots: { starts_at: string; ends_at: string }[]) {
  const { data, error } = await supabase.rpc('create_booking_holds', {
    p_location: locationId,
    p_resource_ids: resourceIds,
    p_slots: slots,
  });
  if (error) throw rpcError(error);
  return data as {
    group_id: string;
    total_cents: number;
    hold_expires_at: string;
    bookings: { booking_id: string; starts_at: string; total_cents: number }[];
  };
}

/** The signed-in user's booking rules at a location (member or not, window, included time). */
export async function myBookingTerms(locationId: string): Promise<BookingTerms> {
  const { data, error } = await supabase.rpc('my_booking_terms', { p_location: locationId });
  if (error) throw rpcError(error);
  return data as BookingTerms;
}

/** Exact server price for a selection, including member benefits. */
export async function quoteBooking(locationId: string, resourceIds: string[], slots: { starts_at: string; ends_at: string }[]): Promise<Quote> {
  const { data, error } = await supabase.rpc('quote_booking', { p_location: locationId, p_resource_ids: resourceIds, p_slots: slots });
  if (error) throw rpcError(error);
  return data as Quote;
}

/** Confirms a checkout that is fully covered by included cage time. */
export async function confirmFreeCheckout(groupId: string) {
  const { error } = await supabase.rpc('confirm_free_checkout', { p_group: groupId });
  if (error) throw rpcError(error);
}

export async function releaseGroup(groupId: string) {
  await supabase.rpc('release_checkout_group', { p_group: groupId });
}

export async function releaseHold(bookingId: string) {
  await supabase.rpc('release_booking_hold', { p_booking: bookingId });
}

/** Creates a Stripe Checkout session for a group of holds and returns its URL. */
export async function startCheckout(groupId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>('create-checkout', {
    body: { group_id: groupId },
  });
  if (error) throw await functionError(error, 'Could not start payment. Please try again.');
  if (!data?.url) throw new Error('Could not start payment. Please try again.');
  return data.url;
}

export async function myBookings(): Promise<MyBooking[]> {
  const { data, error } = await supabase.rpc('my_bookings');
  if (error) throw rpcError(error);
  return (data ?? []) as MyBooking[];
}

export async function cancelBooking(bookingId: string): Promise<number> {
  const { data, error } = await supabase.functions.invoke<{ refund_cents: number }>('cancel-booking', {
    body: { booking_id: bookingId },
  });
  if (error) throw await functionError(error, 'Could not cancel. Please try again.');
  return data?.refund_cents ?? 0;
}

/** Mirrors the server rule: full refund 24h+ before the start, half after that. */
export function refundPreview(b: Pick<MyBooking, 'total_cents' | 'refund_cents' | 'starts_at'>, now = new Date()): number {
  const held = Math.max(0, b.total_cents - (b.refund_cents ?? 0));
  const hours = (new Date(b.starts_at).getTime() - now.getTime()) / 3_600_000;
  return hours >= 24 ? held : Math.floor(held / 2);
}

/** Formats an ISO timestamp in a location's time zone. */
export function fmtInZone(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date(iso));
}

/* ---------------- Rescheduling ---------------- */

export interface ReschedulePlan {
  starts_at: string;
  ends_at: string;
  resources: string[];
  held_cents: number;
  new_cents: number;
  refund_cents: number;
}

/** What moving the booking would do (cages, price, refund). Nothing changes. */
export async function previewReschedule(bookingId: string, startsAt: string): Promise<ReschedulePlan> {
  const { data, error } = await supabase.rpc('reschedule_preview', { p_booking: bookingId, p_starts_at: startsAt });
  if (error) throw rpcError(error);
  return data as ReschedulePlan;
}

export async function rescheduleBooking(bookingId: string, startsAt: string): Promise<ReschedulePlan> {
  const { data, error } = await supabase.functions.invoke<ReschedulePlan>('reschedule-booking', {
    body: { booking_id: bookingId, starts_at: startsAt },
  });
  if (error) throw await functionError(error, 'Could not change your booking. Please try again.');
  return data!;
}
