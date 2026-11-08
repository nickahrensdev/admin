import { createHmac } from 'node:crypto';
import type { Page } from '@playwright/test';

export const USERS = {
  nick: { id: '00000000-0000-0000-0000-0000000000a1', email: 'nick@test.local' }, // super admin
  bob: { id: '00000000-0000-0000-0000-0000000000b1', email: 'bob@test.local' }, // customer, signed waiver
  cara: { id: '00000000-0000-0000-0000-0000000000c1', email: 'cara@test.local' }, // customer, no waiver
  dana: { id: '00000000-0000-0000-0000-0000000000d1', email: 'dana@test.local' }, // location manager
} as const;

const SECRET = 'e2e-test-secret-e2e-test-secret-123456'; // matches tests/e2e/postgrest.conf

const b64 = (v: string | Buffer) => Buffer.from(v).toString('base64url');

function jwt(sub: string, email: string): string {
  const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64(JSON.stringify({ sub, email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 }));
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** Signs in as a test user by putting a session where supabase-js keeps it, then opens a page. */
export async function signInAs(page: Page, who: keyof typeof USERS, path = '#/home') {
  const u = USERS[who];
  const session = {
    access_token: jwt(u.id, u.email),
    refresh_token: 'test',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: u.id, email: u.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} },
  };
  await page.addInitScript((s) => localStorage.setItem('sb-127-auth-token', s), JSON.stringify(session));
  await page.goto(path);
}

/** A weekday (0 = Sunday) a week or more ahead, as YYYY-MM-DD in Chicago. */
export function nextWeekday(dow: number, weeks = 1): string {
  const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()) + 'T12:00:00Z');
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() + ((dow - today.getUTCDay() + 7) % 7) + 7 * weeks);
  return d.toISOString().slice(0, 10);
}
