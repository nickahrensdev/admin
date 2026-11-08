// Sends queued booking emails (confirmation, reminder, cancellation) through Resend.
// Called every minute by pg_cron. It only sends what's already in email_outbox,
// so it needs no caller authentication.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM (e.g. "The Yard <bookings@yourdomain.com>").
// Optional: EMAIL_REPLY_TO, APP_URL (defaults to the GitHub Pages site).
import { CORS, adminClient, json } from '../_shared/common.ts';
import { render, renderPriceChange, type Job } from './render.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  if (!apiKey || !from) return json({ configured: false });

  try {
    const db = adminClient();
    const { data: queued, error: qe } = await db.rpc('email_queue_reminders');
    if (qe) throw qe;
    const { data, error } = await db.rpc('email_claim', { p_limit: 25 });
    if (error) throw error;
    const jobs = (data ?? []) as Job[];

    // One email per customer per checkout (several dates paid together) and kind.
    const groups = new Map<string, Job[]>();
    for (const j of jobs) {
      const key = j.kind === 'price_change' ? j.id : `${j.kind}|${j.to}|${j.checkout_group ?? j.booking.id}`;
      groups.set(key, [...(groups.get(key) ?? []), j]);
    }

    let sent = 0;
    let failed = 0;
    for (const all of groups.values()) {
      const ids = all.map((g) => g.id).sort();
      // A confirmation shouldn't list sessions that were cancelled before it went out.
      const group = all[0].kind === 'confirmation' ? all.filter((g) => g.booking.status === 'confirmed') : all;
      if (group.length === 0) {
        await db.rpc('email_mark', { p_ids: ids, p_error: null });
        continue;
      }
      try {
        const { subject, html, text } = group[0].kind === 'price_change' ? renderPriceChange(group[0]) : render(group);
        const res = await fetch(Deno.env.get('RESEND_API_URL') ?? 'https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': await idempotencyKey(ids),
          },
          body: JSON.stringify({
            from,
            to: [group[0].to],
            subject,
            html,
            text,
            ...(Deno.env.get('EMAIL_REPLY_TO') && { reply_to: Deno.env.get('EMAIL_REPLY_TO') }),
          }),
        });
        if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
        await db.rpc('email_mark', { p_ids: ids, p_error: null });
        sent++;
      } catch (err) {
        failed++;
        console.error('send-emails: failed', ids, err);
        await db.rpc('email_mark', { p_ids: ids, p_error: String((err as Error).message ?? err).slice(0, 500) });
      }
    }
    return json({ configured: true, reminders_queued: queued ?? 0, sent, failed });
  } catch (err) {
    console.error('send-emails failed', err);
    return json({ error: 'Could not send emails.' }, 500);
  }
});

async function idempotencyKey(ids: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ids.join(',')));
  return 'yard-' + Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

