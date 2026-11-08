import { supabase } from '../lib/supabase';
import { safeError } from '../lib/errors';
import { rpcError } from './bookings';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  starts_at: string;
  expires_at: string | null;
  dismissible: boolean;
  location_name: string | null;
}

export interface AdminAnnouncement extends Announcement {
  location_id: string | null;
  archived: boolean;
  created_at: string;
  created_by: string | null;
  dismissals: number;
}

export interface AnnouncementInput {
  title: string;
  body: string;
  location_id: string | null;
  starts_at: string;
  expires_at: string | null;
  dismissible: boolean;
  archived?: boolean;
}

export async function myAnnouncements(): Promise<Announcement[]> {
  const { data, error } = await supabase.rpc('my_announcements');
  if (error) throw rpcError(error);
  return (data ?? []) as Announcement[];
}

export async function dismissAnnouncement(id: string) {
  const { error } = await supabase.rpc('dismiss_announcement', { p_announcement: id });
  if (error) throw rpcError(error);
}

export async function adminAnnouncements(): Promise<AdminAnnouncement[]> {
  const { data, error } = await supabase.rpc('admin_announcements');
  if (error) throw rpcError(error);
  return (data ?? []) as AdminAnnouncement[];
}

export async function saveAnnouncement(id: string | null, input: AnnouncementInput) {
  const row = { ...input, title: input.title.trim(), body: input.body.trim() };
  const { error } = id
    ? await supabase.from('announcements').update(row).eq('id', id)
    : await supabase.from('announcements').insert(row);
  if (error) {
    if (error.code === '23514') throw new Error('“Hide after” must be later than “Show from”.');
    throw safeError(error);
  }
}

export async function deleteAnnouncement(id: string) {
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  if (error) throw safeError(error);
}

/** Emails everyone with a booking at a location on a day. Dry run returns how many would get it. */
export async function emailDaysCustomers(locationId: string, date: string, subject: string, body: string, dryRun = false): Promise<number> {
  const { data, error } = await supabase.rpc('queue_customer_notice', {
    p_location: locationId, p_date: date, p_subject: subject, p_body: body, p_dry_run: dryRun,
  });
  if (error) throw rpcError(error);
  return data as number;
}
