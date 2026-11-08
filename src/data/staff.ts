import { supabase } from '../lib/supabase';
import { functionError, rpcError, type Quote } from './bookings';
import type { ResourceType } from './locations';

export type BookingKind = 'online' | 'walk_in' | 'block';
export type PaymentMethod = 'stripe' | 'cash' | 'card' | 'comp';
export type RefundChoice = 'full' | 'policy' | 'none';

export interface StaffLocation {
  id: string;
  name: string;
  timezone: string;
  can_manage: boolean;
}

export interface StaffCustomer {
  id: string;
  username: string;
  display_name: string;
  email: string;
  member_tier?: string | null;
  /** False when they haven't signed the current waiver. */
  waiver_ok?: boolean;
}

export interface StaffBooking {
  id: string;
  kind: BookingKind;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
  starts_at: string;
  ends_at: string;
  total_cents: number;
  discount_cents: number;
  refund_cents: number;
  payment_method: PaymentMethod | null;
  paid_online: boolean;
  checked_in_at: string | null;
  no_show: boolean;
  note: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  created_at: string;
  hold_expires_at: string | null;
  customer: Omit<StaffCustomer, 'member_tier'> | null;
  member_tier: string | null;
  created_by: string | null;
  included_minutes: number;
  resource_ids: string[];
}

export interface StaffDay {
  location_id: string;
  date: string;
  timezone: string;
  opens_at: string | null;
  closes_at: string | null;
  closed_reason: string | null;
  can_manage: boolean;
  resources: { id: string; name: string; type: ResourceType }[];
  bookings: StaffBooking[];
}

export interface SlotInput {
  starts_at: string;
  ends_at: string;
}

export async function staffLocations(): Promise<StaffLocation[]> {
  const { data, error } = await supabase.rpc('staff_locations');
  if (error) throw rpcError(error);
  return (data ?? []) as StaffLocation[];
}

export async function staffDay(locationId: string, date: string, includeCancelled = false): Promise<StaffDay> {
  const { data, error } = await supabase.rpc('staff_day', {
    p_location: locationId,
    p_date: date,
    p_include_cancelled: includeCancelled,
  });
  if (error) throw rpcError(error);
  return data as StaffDay;
}

export async function setAttendance(bookingId: string, state: 'checked_in' | 'no_show' | 'none') {
  const { error } = await supabase.rpc('staff_set_attendance', { p_booking: bookingId, p_state: state });
  if (error) throw rpcError(error);
}

export async function findCustomers(locationId: string, query: string): Promise<StaffCustomer[]> {
  const { data, error } = await supabase.rpc('staff_find_customers', { p_location: locationId, p_query: query });
  if (error) throw rpcError(error);
  return (data ?? []) as StaffCustomer[];
}

export async function staffQuote(locationId: string, resourceIds: string[], slots: SlotInput[], userId: string | null): Promise<Quote> {
  const { data, error } = await supabase.rpc('staff_quote', {
    p_location: locationId,
    p_resource_ids: resourceIds,
    p_slots: slots,
    p_user: userId,
  });
  if (error) throw rpcError(error);
  return data as Quote;
}

export interface StaffBookingInput {
  locationId: string;
  kind: 'walk_in' | 'block';
  resourceIds: string[];
  slots: SlotInput[];
  userId?: string | null;
  guestName?: string;
  guestPhone?: string;
  note?: string;
  paymentMethod?: 'cash' | 'card' | 'comp';
}

export async function createStaffBooking(input: StaffBookingInput): Promise<{ total_cents: number; bookings: { booking_id: string }[] }> {
  const { data, error } = await supabase.rpc('staff_create_booking', {
    p_location: input.locationId,
    p_kind: input.kind,
    p_resource_ids: input.resourceIds,
    p_slots: input.slots,
    p_user: input.userId ?? null,
    p_guest_name: input.guestName ?? null,
    p_guest_phone: input.guestPhone ?? null,
    p_note: input.note ?? null,
    p_payment_method: input.paymentMethod ?? null,
  });
  if (error) throw rpcError(error);
  return data;
}

/** Moves a booking to another cage (or turf) of the same kind, same time. Anything already there swaps into the vacated cage. */
export async function moveBooking(
  bookingId: string,
  fromResourceId: string,
  toResourceId: string,
): Promise<{ from: string; to: string; swapped: { booking_id: string; who: string }[] }> {
  const { data, error } = await supabase.rpc('staff_move_booking', { p_booking: bookingId, p_from: fromResourceId, p_to: toResourceId });
  if (error) throw rpcError(error);
  return data;
}

/** Staff cancellation; online payments are refunded through Stripe. */
export async function staffCancel(bookingId: string, refund: RefundChoice): Promise<{ refund_cents: number; refunded_online: boolean }> {
  const { data, error } = await supabase.functions.invoke<{ refund_cents: number; refunded_online: boolean }>('cancel-booking', {
    body: { booking_id: bookingId, refund },
  });
  if (error) throw await functionError(error, 'Could not cancel. Please try again.');
  return data ?? { refund_cents: 0, refunded_online: false };
}

/* ---------------- Users page: per-location roles ---------------- */

export interface LocationRole {
  user_id: string;
  role: string;
  location_id: string;
  location_name: string;
}

export async function listLocationRoles(): Promise<LocationRole[]> {
  const { data, error } = await supabase.rpc('admin_list_location_roles');
  if (error) throw rpcError(error);
  return (data ?? []) as LocationRole[];
}

export async function setLocationRoles(userId: string, role: string, locationIds: string[]) {
  const { error } = await supabase.rpc('set_user_location_roles', {
    p_user: userId,
    p_role: role,
    p_locations: locationIds,
  });
  if (error) throw rpcError(error);
}

/** Who the booking is for, in one line. */
export function bookingWho(b: StaffBooking): string {
  if (b.kind === 'block') return b.note ?? 'Blocked';
  if (b.customer) return b.customer.display_name;
  return b.guest_name ?? 'Walk-in';
}

/** How it was paid, in a few words. */
export function paymentLabel(b: StaffBooking): string {
  if (b.kind === 'block') return 'Blocked time';
  if (b.status === 'pending') return 'Paying online…';
  if (b.payment_method === 'comp') return 'Comp (free)';
  if (b.payment_method === 'cash') return 'Cash at desk';
  if (b.payment_method === 'card') return 'Card at desk';
  if (b.paid_online) return 'Paid online';
  if (b.total_cents === 0 && b.included_minutes > 0) return 'Included in membership';
  return 'Online';
}
