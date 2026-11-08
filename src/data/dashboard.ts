import { supabase } from '../lib/supabase';
import { rpcError } from './bookings';

export interface Dashboard {
  today: { bookings: number; checked_in: number; still_to_come: number; revenue_cents: number; hours: number };
  next_7_days: number;
  attention: {
    unpaid_walk_ins: { id: string; location_id: string; starts_at: string; who: string | null; cents: number }[];
    possible_no_shows: { id: string; location_id: string; starts_at: string; who: string | null }[];
    unsigned_waivers: { user_id: string; name: string }[];
    past_due_members: number;
  };
  members: { active: number; new_7_days: number };
  signups_7_days: number;
  open_todos: number;
}

export async function adminDashboard(): Promise<Dashboard> {
  const { data, error } = await supabase.rpc('admin_dashboard');
  if (error) throw rpcError(error);
  return data as Dashboard;
}
