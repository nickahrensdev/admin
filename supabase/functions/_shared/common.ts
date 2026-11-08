import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export function env(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  throw new Error(`Missing environment variable: ${names.join(' or ')}`);
}

/** Service-role client: bypasses RLS. Only use after checking who the caller is. */
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The signed-in user making the request, verified with Supabase Auth, or null. */
export async function requestUser(req: Request) {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

let stripeClient: Stripe | null = null;
/** Stripe client, or null when STRIPE_SECRET_KEY isn't configured yet. */
export function stripe(): Stripe | null {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) return null;
  stripeClient ??= new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
  return stripeClient;
}

/** Where to send customers back to after Stripe Checkout. Only known app origins are accepted. */
export function appBaseUrl(req: Request): string {
  const allowed = (Deno.env.get('APP_ORIGINS') ??
    'https://nickahrensdev.github.io,http://localhost:5173,http://localhost:4173')
    .split(',')
    .map((s) => s.trim());
  const origin = req.headers.get('origin') ?? '';
  const base = allowed.includes(origin) ? origin : allowed[0];
  return `${base}/the-yard/`;
}

/** Refund owed when a customer cancels: full refund 24h+ before start, half after that. */
export function refundFor(totalCents: number, startsAt: Date, now = new Date()): number {
  const hours = (startsAt.getTime() - now.getTime()) / 3_600_000;
  return hours >= 24 ? totalCents : Math.floor(totalCents / 2);
}

/**
 * A friendly message plus, while Stripe is in test mode, the underlying reason
 * (Stripe or database error) so setup problems are visible without reading logs.
 */
export function failure(friendly: string, err: unknown): string {
  const testMode = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').startsWith('sk_test_');
  // deno-lint-ignore no-explicit-any
  const e = err as any;
  const detail = typeof e?.message === 'string' ? e.message : '';
  return testMode && detail ? `${friendly} (${detail})` : friendly;
}
