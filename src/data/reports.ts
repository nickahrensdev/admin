import { supabase } from '../lib/supabase';
import { rpcError } from './bookings';

export interface Report {
  from: string;
  to: string;
  revenue: { gross_cents: number; refund_cents: number; net_cents: number; member_discount_cents: number; comp_value_cents: number };
  by_method: { method: 'online' | 'included' | 'cash' | 'card' | 'comp' | 'other'; bookings: number; net_cents: number }[];
  bookings: {
    confirmed: number;
    cancelled: number;
    walk_ins: number;
    online: number;
    checked_in: number;
    no_shows: number;
    customers: number;
    session_hours: number;
    included_hours: number;
  };
  utilization: { type: 'batting_cage' | 'turf'; open_hours: number; booked_hours: number; blocked_hours: number }[];
  daily: { day: string; net_cents: number; bookings: number; hours: number }[];
  by_hour: { hour: number; open_slots: number; booked_slots: number }[];
  top_customers: { name: string; username: string | null; bookings: number; hours: number; net_cents: number }[];
  memberships: {
    active: number;
    past_due: number;
    ending: number;
    new_in_range: number;
    mrr_cents: number;
    by_tier: { tier: string; members: number }[];
  };
  signups: number;
}

export async function reportSummary(from: string, to: string, locationId: string | null): Promise<Report> {
  const { data, error } = await supabase.rpc('report_summary', { p_from: from, p_to: to, p_location: locationId });
  if (error) throw rpcError(error);
  return data as Report;
}
