// Starts Stripe Checkout for a booking hold the signed-in customer owns.
// Body: { booking_id } → { url }
import { CORS, adminClient, appBaseUrl, json, requestUser, stripe } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await requestUser(req);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const { booking_id } = await req.json().catch(() => ({}));
    if (typeof booking_id !== 'string') return json({ error: 'Missing booking.' }, 400);

    const db = adminClient();
    const { data: booking, error } = await db
      .from('bookings')
      .select('id, user_id, status, starts_at, ends_at, total_cents, hold_expires_at, location:locations(name, timezone), items:booking_items(price_cents, resource:resources(name))')
      .eq('id', booking_id)
      .maybeSingle();
    if (error) throw error;
    if (!booking || booking.user_id !== user.id) return json({ error: 'Booking not found.' }, 404);
    if (booking.status !== 'pending' || !booking.hold_expires_at || new Date(booking.hold_expires_at) <= new Date()) {
      return json({ error: 'This hold has expired. Please pick your time again.' }, 409);
    }

    const s = stripe();
    if (!s) return json({ error: 'Online payments aren’t set up yet. Please try again later.' }, 503);

    // deno-lint-ignore no-explicit-any
    const loc = booking.location as any;
    const tz = loc?.timezone ?? 'America/Chicago';
    const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(iso));
    const when = `${fmt(booking.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmt(booking.starts_at, { hour: 'numeric', minute: '2-digit' })}–${fmt(booking.ends_at, { hour: 'numeric', minute: '2-digit' })}`;

    const base = appBaseUrl(req);
    // Stripe requires at least 30 minutes; the hold lasts slightly longer.
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60 + 30;

    const session = await s.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email ?? undefined,
      client_reference_id: booking.id,
      metadata: { booking_id: booking.id },
      payment_intent_data: { metadata: { booking_id: booking.id } },
      // deno-lint-ignore no-explicit-any
      line_items: (booking.items as any[]).map((item) => ({
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: item.price_cents,
          product_data: { name: `${item.resource?.name ?? 'Booking'} · ${when}`, description: loc?.name ?? 'The Yard' },
        },
      })),
      expires_at: expiresAt,
      success_url: `${base}#/bookings?paid=${booking.id}`,
      cancel_url: `${base}#/book?cancelled=${booking.id}`,
    });

    const { error: saveError } = await db.rpc('set_booking_checkout_session', { p_booking: booking.id, p_session: session.id });
    if (saveError) throw saveError;

    return json({ url: session.url });
  } catch (err) {
    console.error('create-checkout failed', err);
    return json({ error: 'Could not start payment. Please try again.' }, 500);
  }
});
