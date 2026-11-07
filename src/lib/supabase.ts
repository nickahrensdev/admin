import { createClient } from '@supabase/supabase-js';

/**
 * Public Supabase settings. Both values are safe to ship in the browser:
 * the publishable key only allows what the database's row level security
 * policies allow. Never put the secret / service-role key in front-end code.
 * They can be overridden at build time with VITE_SUPABASE_URL and
 * VITE_SUPABASE_PUBLISHABLE_KEY.
 */
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://cemnqswodgaqmctqbogo.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY: string =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_8Myqd5evVDJJ6kVf4lyUdA_IATwcm2x';

/** Where Supabase sends people back after email links (confirm, change email). */
export const APP_URL = `${window.location.origin}${import.meta.env.BASE_URL}`;

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // PKCE puts the one-time code in ?code=…, which doesn't clash with the
    // app's #/hash routes the way the implicit flow's #access_token would.
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});
