// Sends queued booking emails (confirmation, reminder, cancellation) through Resend.
// Called every minute by pg_cron. It only sends what's already in email_outbox,
// so it needs no caller authentication.
//
// Secrets: RESEND_API_KEY, EMAIL_FROM (e.g. "The Yard <bookings@yourdomain.com>").
// Optional: EMAIL_REPLY_TO, APP_URL (defaults to the GitHub Pages site).
import { CORS, adminClient, json } from '../_shared/common.ts';

interface Job {
  id: string;
  kind: 'confirmation' | 'cancellation' | 'reminder';
  checkout_group: string | null;
  to: string;
  name: string;
  booking: {
    id: string;
    kind: 'online' | 'walk_in';
    status: string;
    starts_at: string;
    ends_at: string;
    total_cents: number;
    discount_cents: number;
    refund_cents: number;
    payment_method: 'stripe' | 'cash' | 'card' | 'comp' | null;
    paid_online: boolean;
    location: { name: string; timezone: string; address: string | null };
    items: { name: string; included_minutes: number }[] | null;
  };
}

const APP_URL = (Deno.env.get('APP_URL') ?? 'https://nickahrensdev.github.io/the-yard/').replace(/\/?$/, '/');

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const day = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
const time = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

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
      const key = `${j.kind}|${j.to}|${j.checkout_group ?? j.booking.id}`;
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
        const { subject, html, text } = render(group);
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

/* ------------------------------------------------------------------ */
/* Email content                                                       */
/* ------------------------------------------------------------------ */

function render(group: Job[]): { subject: string; html: string; text: string } {
  const first = group[0];
  const b = first.booking;
  const tz = b.location.timezone;
  const when = `${day(b.starts_at, tz)} at ${time(b.starts_at, tz)}`;
  const sessions = [...group].sort((x, y) => Date.parse(x.booking.starts_at) - Date.parse(y.booking.starts_at));
  const total = sessions.reduce((s, j) => s + j.booking.total_cents, 0);
  const saved = sessions.reduce((s, j) => s + j.booking.discount_cents, 0);
  const included = sessions.reduce((s, j) => s + (j.booking.items ?? []).reduce((a, i) => a + i.included_minutes, 0), 0);
  const refund = sessions.reduce((s, j) => s + j.booking.refund_cents, 0);
  const hi = `Hi ${esc(first.name || 'there')},`;

  let subject: string;
  let heading: string;
  let intro: string;
  const facts: [string, string][] = [];
  let footer: string;

  if (first.kind === 'confirmation') {
    subject = sessions.length > 1 ? `You're booked: ${sessions.length} sessions starting ${when}` : `You're booked: ${when}`;
    heading = "You're booked";
    intro =
      b.kind === 'walk_in'
        ? `${hi} here's the session we booked for you at the front desk.`
        : `${hi} thanks for booking. Here ${sessions.length > 1 ? 'are your sessions' : 'is your session'}.`;
    if (b.kind === 'walk_in') {
      facts.push(['Paid', b.payment_method === 'comp' ? 'On the house' : `${money(total)} at the desk (${b.payment_method === 'card' ? 'card' : 'cash'})`]);
    } else if (total > 0) {
      facts.push(['Paid', `${money(total)} online`]);
    } else {
      facts.push(['Paid', 'Nothing. Covered by your membership']);
    }
    if (included > 0) facts.push(['Included cage time', `${+(included / 60).toFixed(1)} hr from your membership`]);
    if (saved > 0 && b.payment_method !== 'comp') facts.push(['Member savings', money(saved)]);
    footer =
      'Need to cancel? Cancel 24+ hours before your session for a full refund, or less than 24 hours before for 50% back, from My bookings.';
  } else if (first.kind === 'reminder') {
    subject = `Reminder: ${when}`;
    heading = 'See you soon';
    intro = `${hi} this is a reminder about your session at The Yard.`;
    footer = 'Check in at the front desk when you arrive. Cancelling less than 24 hours before refunds 50%.';
  } else {
    subject = `Booking cancelled: ${when}`;
    heading = 'Booking cancelled';
    intro = `${hi} your booking has been cancelled.`;
    if (refund > 0) {
      facts.push([
        'Refund',
        b.paid_online
          ? `${money(refund)} back to your card. It usually shows up in 5–10 business days.`
          : `${money(refund)}, handled at the front desk.`,
      ]);
    } else if (total > 0) {
      facts.push(['Refund', 'None was due.']);
    }
    footer = "We hope to see you back soon. Book another time whenever you're ready.";
  }

  const rows = sessions
    .map((j) => {
      const s = j.booking;
      const cages = (s.items ?? []).map((i) => i.name).join(', ');
      return `<tr><td style="padding:10px 0;border-top:1px solid #1f2836;">
        <div style="font-family:'Arial Narrow',Arial,sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:18px;color:#ffffff;">${esc(day(s.starts_at, tz))}</div>
        <div style="font-size:15px;color:#eef2f7;">${esc(time(s.starts_at, tz))} – ${esc(time(s.ends_at, tz))}</div>
        <div style="font-size:14px;color:#8d97a8;">${esc(cages)}</div>
      </td></tr>`;
    })
    .join('');
  const loc = `${esc(b.location.name)}${b.location.address ? `<br><span style="color:#8d97a8;">${esc(b.location.address)}</span>` : ''}`;
  const factRows = facts
    .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#8d97a8;font-size:14px;vertical-align:top;white-space:nowrap;">${esc(k)}</td><td style="padding:4px 0;font-size:14px;color:#eef2f7;">${esc(v)}</td></tr>`)
    .join('');
  const button = first.kind === 'cancellation'
    ? { href: `${APP_URL}#/book`, label: 'Book a session' }
    : { href: `${APP_URL}#/bookings`, label: 'View my bookings' };

  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="dark"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background-color:#06080c;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#06080c;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
<tr><td style="padding:0 4px 20px;font-family:'Arial Narrow',Arial,sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;"><span style="color:#6ea4ff;font-size:16px;letter-spacing:1px;">The</span><span style="color:#eef2f7;font-size:28px;letter-spacing:1px;">&nbsp;Yard</span></td></tr>
<tr><td style="background-color:#0f141c;border:1px solid #1f2836;border-top:3px solid #1f6bff;border-radius:12px;padding:28px 26px;font-family:Arial,Helvetica,sans-serif;color:#eef2f7;">
<h1 style="margin:0 0 12px;font-family:'Arial Narrow',Arial,sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;font-size:28px;line-height:1.1;color:#ffffff;">${esc(heading)}</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#c9d1dc;">${intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>
<p style="margin:12px 0 16px;font-size:14px;line-height:1.5;color:#eef2f7;border-top:1px solid #1f2836;padding-top:12px;">${loc}</p>
${factRows ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;">${factRows}</table>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;"><tr><td align="center" style="background-color:#1f6bff;border-radius:8px;"><a href="${button.href}" style="display:inline-block;padding:13px 26px;font-family:'Arial Narrow',Arial,sans-serif;font-style:italic;font-weight:800;text-transform:uppercase;letter-spacing:1px;font-size:16px;color:#ffffff;text-decoration:none;">${button.label}</a></td></tr></table>
<p style="margin:0;font-size:13px;line-height:1.5;color:#8d97a8;">${esc(footer)}</p>
</td></tr>
<tr><td style="padding:18px 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5d6778;">The Yard · <span style="color:#6ea4ff;font-style:italic;font-weight:700;text-transform:uppercase;">Train. Improve. Compete.</span></td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    heading,
    '',
    intro.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
    '',
    ...sessions.map((j) => `${day(j.booking.starts_at, tz)}, ${time(j.booking.starts_at, tz)} – ${time(j.booking.ends_at, tz)} · ${(j.booking.items ?? []).map((i) => i.name).join(', ')}`),
    b.location.name + (b.location.address ? ` · ${b.location.address}` : ''),
    '',
    ...facts.map(([k, v]) => `${k}: ${v}`),
    '',
    `${button.label}: ${button.href}`,
    '',
    footer,
  ].join('\n');

  return { subject, html, text };
}
