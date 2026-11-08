-- Membership tier switching: each tier gets a Stripe product (created on first
-- use by the change-membership Edge Function) so a subscription can move to the
-- new tier's price.
alter table public.membership_tiers add column stripe_product_id text;
