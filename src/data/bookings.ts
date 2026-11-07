import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
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

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'expired';

export interface MyBooking {
  id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  total_cents: number;
  refund_cents: number;
  hold_expires_at: string | null;
  created_at: string;
  location: { id: string; name: string; timezone: string };
  items: { name: string; type: ResourceType; price_cents: number }[] | null;
}

function rpcError(error: { message: string; code?: string }): Error {
  if (error.code === '42501' && /sign in/i.test(error.message)) return new Error('Please sign in to book.');
  return new Error(error.message || 'Something went wrong.');
}

async function functionError(error: unknown, fallback: string): Promise<Error> {
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

export async function createHold(locationId: string, resourceIds: string[], startsAt: string, endsAt: string) {
  const { data, error } = await supabase.rpc('create_booking_hold', {
    p_location: locationId,
    p_resource_ids: resourceIds,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
  });
  if (error) throw rpcError(error);
  return data as { booking_id: string; total_cents: number; hold_expires_at: string };
}

export async function releaseHold(bookingId: string) {
  await supabase.rpc('release_booking_hold', { p_booking: bookingId });
}

/** Creates a Stripe Checkout session and returns its URL. */
export async function startCheckout(bookingId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{ url: string }>('create-checkout', {
    body: { booking_id: bookingId },
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
export function refundPreview(b: Pick<MyBooking, 'total_cents' | 'starts_at'>, now = new Date()): number {
  const hours = (new Date(b.starts_at).getTime() - now.getTime()) / 3_600_000;
  return hours >= 24 ? b.total_cents : Math.floor(b.total_cents / 2);
}

/** Formats an ISO timestamp in a location's time zone. */
export function fmtInZone(iso: string, tz: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(new Date(iso));
}
