import { supabase } from '../lib/supabase';
import { rpcError } from './bookings';

export interface Waiver {
  id: string;
  version: number;
  title: string;
  body: string;
}

export interface WaiverStatus {
  required: boolean;
  signed: boolean;
  current: { accepted_at: string; signer_name: string; participants: string | null; version: number } | null;
  last_signed_at: string | null;
}

export interface WaiverSignature {
  signerName: string;
  participants: string;
}

export async function currentWaiver(): Promise<Waiver | null> {
  const { data, error } = await supabase.rpc('current_waiver');
  if (error) throw rpcError(error);
  return (data as Waiver | null) ?? null;
}

export async function myWaiverStatus(): Promise<WaiverStatus> {
  const { data, error } = await supabase.rpc('my_waiver_status');
  if (error) throw rpcError(error);
  return data as WaiverStatus;
}

export async function acceptWaiver(waiverId: string, sig: WaiverSignature) {
  const { error } = await supabase.rpc('accept_waiver', {
    p_waiver: waiverId,
    p_signer_name: sig.signerName,
    p_participants: sig.participants || null,
  });
  if (error) throw rpcError(error);
}

export async function staffRecordWaiver(userId: string, signerName: string, participants?: string) {
  const { error } = await supabase.rpc('staff_record_waiver', {
    p_user: userId,
    p_signer_name: signerName,
    p_participants: participants || null,
  });
  if (error) throw rpcError(error);
}

export interface WaiverOverview {
  versions: (Waiver & { is_active: boolean; created_at: string; created_by: string | null; signatures: number })[];
  accounts: number;
  recent: {
    accepted_at: string;
    signer_name: string;
    participants: string | null;
    source: 'signup' | 'app' | 'desk';
    version: number;
    username: string;
    display_name: string;
  }[];
}

export async function adminWaiverOverview(): Promise<WaiverOverview> {
  const { data, error } = await supabase.rpc('admin_waiver_overview');
  if (error) throw rpcError(error);
  return data as WaiverOverview;
}

export async function publishWaiver(title: string, body: string): Promise<number> {
  const { data, error } = await supabase.rpc('admin_publish_waiver', { p_title: title, p_body: body });
  if (error) throw rpcError(error);
  return data as number;
}

/** True when a database error means "sign the waiver first". */
export function isWaiverRequired(error: unknown): boolean {
  return error instanceof Error && /sign the waiver/i.test(error.message);
}
