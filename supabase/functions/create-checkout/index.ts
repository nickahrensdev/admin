// Starts Stripe Checkout for a booking hold the signed-in customer owns.
// Body: { group_id } (or { booking_id }) → { url }
import { CORS, adminClient, appBaseUrl, json, requestUser, stripe } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await requestUser(req);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    // { group_id } for multi-date checkouts; { booking_id } still works for a single booking.
    const { group_id, booking_id } = await req.json().catch(() => ({}));
    if (typeof group_id !== 'string' && typeof booking_id !== 'string') return json({ error: 'Missing booking.' }, 400);

    const db = adminClient();
    let query = db
      .from('bookings')
      .select('id, user_id, status, starts_at, ends_at, total_cents, hold_expires_at, checkout_group, location:locations(name, timezone), items:booking_items(price_cents, resource:resources(name, sort_order))')
      .order('starts_at');
    query = typeof group_id === 'string' ? query.eq('checkout_group', group_id) : query.eq('id', booking_id);
    const { data: bookings, error } = await query;
    if (error) throw error;
    if (!bookings?.length || bookings.some((b) => b.user_id !== user.id)) return json({ error: 'Booking not found.' }, 404);
    const now = new Date();
    if (bookings.some((b) => b.status !== 'pending' || !b.hold_expires_at || new Date(b.hold_expires_at) <= now)) {
      return json({ error: 'This hold has expired. Please pick your times again.' }, 409);
    }

    const s = stripe();
    if (!s) return json({ error: 'Online payments aren’t set up yet. Please try again later.' }, 503);

    // deno-lint-ignore no-explicit-any
    const loc = bookings[0].location as any;
    const tz = loc?.timezone ?? 'America/Chicago';
    const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat('en-US', { timeZone: tz, ...opts }).format(new Date(iso));
    const when = (b: { starts_at: string; ends_at: string }) =>
      `${fmt(b.starts_at, { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmt(b.starts_at, { hour: 'numeric', minute: '2-digit' })}–${fmt(b.ends_at, { hour: 'numeric', minute: '2-digit' })}`;

    const groupKey = bookings[0].checkout_group ?? bookings[0].id;
    // deno-lint-ignore no-explicit-any
    const lineItems = bookings.flatMap((b) => (b.items as any[]).filter((item) => item.price_cents > 0).map((item) => ({
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: item.price_cents,
        product_data: { name: `${item.resource?.name ?? 'Booking'} · ${when(b)}`, description: loc?.name ?? 'The Yard' },
      },
    })));

    if (lineItems.length === 0) return json({ error: 'Nothing to pay for this booking.' }, 400);

    const base = appBaseUrl(req);
    // Stripe requires at least 30 minutes; the hold lasts slightly longer.
    const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60 + 30;

    const session = await s.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email ?? undefined,
      client_reference_id: groupKey,
      metadata: bookings[0].checkout_group ? { group_id: groupKey } : { booking_id: groupKey },
      payment_intent_data: { metadata: bookings[0].checkout_group ? { group_id: groupKey } : { booking_id: groupKey } },
      line_items: lineItems,
      expires_at: expiresAt,
      success_url: `${base}#/bookings?paid=${bookings[0].id}`,
      cancel_url: bookings[0].checkout_group ? `${base}#/book?cancelled_group=${groupKey}` : `${base}#/book?cancelled=${groupKey}`,
    });

    const { error: saveError } = bookings[0].checkout_group
      ? await db.rpc('set_group_checkout_session', { p_group: groupKey, p_session: session.id })
      : await db.rpc('set_booking_checkout_session', { p_booking: groupKey, p_session: session.id });
    if (saveError) throw saveError;

    return json({ url: session.url });
  } catch (err) {
    console.error('create-checkout failed', err);
    return json({ error: 'Could not start payment. Please try again.' }, 500);
  }
});
