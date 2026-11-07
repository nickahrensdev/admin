// Sign in with a username (or email) and password.
//
// Looking up which email belongs to a username has to happen here, on the
// server, so the app never reveals members' email addresses. The browser
// sends { identifier, password } and gets back a session to use.
//
// Deployed with verify_jwt = false (see supabase/config.toml): callers are
// signed out by definition. Every failure returns the same message so the
// function can't be used to discover which usernames exist.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const INVALID = 'Invalid username/email or password.';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function env(...names: string[]): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  throw new Error(`Missing environment variable: ${names.join(' or ')}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  let identifier = '';
  let password = '';
  try {
    const body = await req.json();
    identifier = String(body?.identifier ?? '').trim();
    password = String(body?.password ?? '');
  } catch {
    return json({ error: 'Invalid request.' }, 400);
  }
  if (!identifier || !password) {
    return json({ error: 'Enter your username or email and your password.' }, 400);
  }

  try {
    const url = env('SUPABASE_URL');
    let email = identifier;

    if (!identifier.includes('@')) {
      const admin = createClient(url, env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY'), {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // profiles.username is case-insensitive (citext).
      const { data, error } = await admin
        .from('profiles')
        .select('email')
        .eq('username', identifier)
        .maybeSingle();
      if (error) throw error;
      if (!data?.email) return json({ error: INVALID }, 400);
      email = data.email;
    }

    const client = createClient(url, env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      if (error && /email not confirmed/i.test(error.message)) {
        return json({ error: 'Please confirm your email first. Check your inbox for the link we sent.' }, 400);
      }
      if (error && error.status === 429) {
        return json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);
      }
      return json({ error: INVALID }, 400);
    }

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (err) {
    console.error('sign-in failed', err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
