// Opens Stripe's customer portal so members can update their card,
// switch monthly/yearly or cancel. Body: {} → { url }
import { CORS, adminClient, appBaseUrl, json, requestUser, stripe } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const user = await requestUser(req);
    if (!user) return json({ error: 'Please sign in again.' }, 401);

    const db = adminClient();
    const { data: profile, error } = await db.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
    if (error) throw error;
    if (!profile?.stripe_customer_id) return json({ error: 'No billing account yet.' }, 404);

    const s = stripe();
    if (!s) return json({ error: 'Billing isn’t available right now.' }, 503);

    const portal = await s.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${appBaseUrl(req)}#/memberships`,
    });
    return json({ url: portal.url });
  } catch (err) {
    console.error('billing-portal failed', err);
    return json({ error: 'Could not open billing. Please try again.' }, 500);
  }
});
