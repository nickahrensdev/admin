# The Yard

**Baseball & Performance — Train. Improve. Compete.**

React + TypeScript front end (Vite) for The Yard: one app that holds many smaller apps, each gated by roles and privileges. It has a landing page, sign up / sign in, an authenticated home page and a profile page. Deployed to GitHub Pages from the `develop` branch.

## Getting started

```bash
npm install
npm run dev       # http://localhost:5173/the-yard/
npm run build     # type-check + production build to dist/
npm run preview   # serve the production build locally
```

## Routes

| Path       | Access        | Page                                    |
|------------|---------------|-----------------------------------------|
| `/`        | signed out    | Landing page                            |
| `/signup`  | signed out    | Create account                          |
| `/signin`  | signed out    | Sign in with username or email          |
| `/about`   | everyone      | About The Yard: locations, hours, prices, how booking works, memberships, cancellations (live from the database) |
| `/home`    | signed in     | Dashboard: next session (manage / add to calendar), Book a cage, "Book again", messages, membership usage, front desk summary for staff |
| `/more`    | signed in     | Account, waiver, membership, facility info, staff and admin links, sign out (the phone "More" tab) |
| `/profile` | signed in     | Update username, email, display name, password |
| `/front-desk` | `bookings_view_all` (any location) | Day schedule, check-in, walk-ins, blocked time |

On phones (640px and narrower) signed-in users get a bottom tab bar (Home, Book, Bookings, Member, More; staff see Desk in place of Member) instead of the menu, and the footer is hidden. Booking is two steps: day, length and start time, then "Any open cage" or a specific cage, with a fixed bar at the bottom showing the total. My bookings opens a bottom sheet per session (change date/time, add to calendar (.ics), directions, cancel with the refund shown first). The front desk shows which cages are in use right now, filters for "Now & next" and "Not here yet", and a walk-in form with one-tap start times that can check the customer in straight away.

Signed-in users who visit the public pages are redirected to `/home`; signed-out users who visit protected pages are sent to `/signin` and returned afterwards. The app uses `HashRouter` (`/the-yard/#/profile`) so refreshes and deep links work on GitHub Pages.

## Authentication

A user has a **username**, **email**, **password** and **display name**.

Sign-in and data live in **Supabase** (project `cemnqswodgaqmctqbogo`). Pages and components only use `useAuth()` from `src/auth/AuthContext.tsx`, which delegates to the `AuthService` interface implemented in `src/auth/authService.ts`.

- Customers sign up with username, email, display name and password, then confirm their email.
- Customers sign in with **username or email** and password. Username sign-ins go through the `sign-in` Edge Function (`supabase/functions/sign-in`), which looks up the email on the server so members' emails are never exposed to the browser.
- Changing email sends a confirmation link to the new address; changing password requires the current one.
- **Forgot password** emails a reset link (`?reset=1`), which signs the user in and opens “Choose a new password”.
- The Supabase URL and publishable key in `src/lib/supabase.ts` are public by design; the database's row level security decides what each user can read or change. **Never** put the secret/service-role key in the front end.

### Supabase dashboard settings

Under **Authentication → URL Configuration**:

- **Site URL:** `https://nickahrensdev.github.io/the-yard/`
- **Redirect URLs:** `https://nickahrensdev.github.io/the-yard/**` and `http://localhost:5173/the-yard/**`

Under **Authentication → Emails → Templates**, paste the files from `supabase/templates/` (confirm sign up, change email, reset password).

## Database

Schema changes are SQL files in `supabase/migrations/`. The **Apply database migrations** workflow (`.github/workflows/db-migrate.yml`) runs `supabase db push` whenever migrations land on `develop`. It needs two repository secrets: `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`.

Tables: `profiles`, `roles`, `privileges`, `role_privileges`, `user_roles` (global or per-location), `locations`, `resources`, `location_hours`, `location_closures`, `resource_prices`, `location_peak_hours`. Location 1 is seeded with Cage 1–8 and the Turf; every location gets default hours (Mon–Fri 3–10pm, Sat–Sun 8am–8pm), peak hours (2–8pm daily) and prices (per 30 min: cage $20 / $25 peak, turf $45 / $55 peak), all editable under **Locations**.

Times are local to the location, always on :00 or :30. Prices are stored in cents per 30 minutes.

### Booking & payments (Phase 3)

- `bookings` + `booking_items` (one per cage/turf). An exclusion constraint makes overlapping active items for the same resource impossible.
- **Book** (`/book`): dates (calendar: pick several days, or **Repeat weekly** for N weeks) → length → start time (only times open on every date) → cages/turf → one Stripe Checkout. `create_booking_holds` validates hours/closures per date, computes prices on the server (peak per 30-min slot) and holds all dates for 35 minutes under one `checkout_group`; each date is its own booking and can be cancelled separately. A customer has at most one unpaid checkout.
- Edge Functions: `create-checkout` (Stripe Checkout session), `stripe-webhook` (confirms on `checkout.session.completed`, frees slots on `checkout.session.expired`, auto-refunds if a lapsed hold lost its slot), `cancel-booking` (full refund 24h+ before start, 50% after).
- **My bookings** (`/bookings`): upcoming, cancel with refund preview, past & cancelled.
- Limits: up to 90 days ahead, up to 4 hours, up to 10 cages/turf and 12 dates per checkout.

### Memberships (Phase 4)

- `membership_tiers` (one location or all locations, monthly + optional yearly price), `tier_location_benefits` (per tier **and** location: included cage minutes per calendar month — no rollover, turf never uses them — cage discount %, turf discount %, booking window days, optional max upcoming bookings) and `memberships` (mirrored from Stripe subscriptions by the webhook; benefits apply only while `active`).
- Seeded tiers: **Rookie** ($49/mo, $490/yr, Location 1: 4 cage hrs/mo, 10% / 10%) and **All-Star** ($99/mo, $990/yr, all locations: 8 hrs, 20% / 20%). Edit under **Admin → Membership tiers** (`memberships_manage`).
- Non-members can book 30 days ahead; members get their tier's window (default 90).
- `price_booking` / `quote_booking` compute every price on the server: included cage time first, then discounts. Fully covered checkouts are confirmed without Stripe (`confirm_free_checkout`).
- Edge Functions: `create-membership-checkout` (Stripe subscription Checkout) and `billing-portal` (Stripe customer portal: card, cancel).
- **Switching tiers / billing interval** (`change-membership`): members pick another tier or monthly/yearly on the Membership page, see what it costs, and confirm.
  - Higher tier, or monthly → yearly: starts now; the prorated difference is charged immediately (if the card fails, nothing changes).
  - Lower tier, or yearly → monthly: starts at the next renewal through a Stripe subscription schedule. The member keeps the current tier until then, with no partial credit; `memberships.pending_*` shows the scheduled change, and "Keep <tier>" cancels it.
  - Each tier gets a Stripe product on first use (`membership_tiers.stripe_product_id`). Plan switching stays off in the Stripe customer portal.
- **Applying a new price to current members** (Admin → Membership tiers → "Apply current price to members", `apply-tier-price`): each member moves to the tier's current price at their first renewal at least N days away (you pick N; 30 is common) via a Stripe subscription schedule, sees "Your price changes to … on …" on their Membership page, and gets an email notice. Members already switching tiers are skipped.
- **Included cage time only covers sessions before the member's renewal date** (`current_period_end`). Later sessions are still discounted but not free, so future months can't be booked free and then cancelled or downgraded.

### Front desk (Phase 5)

- **Front desk** page (`/front-desk`) for staff with `bookings_view_all` at a location: a day **timeline** (one column per cage/turf, 30-minute rows, a "now" line) or a phone-friendly **list**. It refreshes every minute.
- With `bookings_manage`:
  - **Check in** / **no-show** (`staff_set_attendance`).
  - **Walk-ins** (`staff_create_booking`, kind `walk_in`): an existing customer (search by name, username or email; member pricing and included cage time apply) or a guest name and phone. Paid by cash, card at the desk, or comp. Repeats weekly up to 12 weeks.
  - **Block time** (kind `block`) for lessons, team rentals, maintenance or events. It uses the same no-overlap rule, so customers can't book over it.
  - **Move** a booking or blocked time to another cage (or turf area) of the same kind, same time and price (`staff_move_booking`). If the target is in use then, those bookings swap into the vacated cage in the same step; if they can't fit there, nothing changes and staff are told why.
  - **Change date / time** of any confirmed booking or blocked time, including its length (`staff_reschedule_booking`). Cages are kept where free, otherwise free ones of the same kind are used; the price doesn't change.
  - **Cancel** any booking through the `cancel-booking` Edge Function with a refund choice (full, cancellation policy, none). Online payments are refunded through Stripe; for walk-ins the amount is recorded for the desk to hand back.
- Tapping an empty timeline cell starts a walk-in for that cage and time.
- Customers see walk-ins booked for them in My bookings ("Booked at the front desk") but can't cancel those online.
- `bookings` gained `kind`, `guest_name`, `guest_phone`, `note`, `payment_method`, `checked_in_at`, `no_show`, `created_by` and `cancelled_by`; `user_id` is empty for guest walk-ins and blocks.

### Rescheduling (customers)

On My bookings, **Change** moves an online booking to another date/time of the same length, until 24 hours before it starts. It's repriced at the new time (`reschedule_preview` shows the result): cheaper, and the difference is refunded to the card; more expensive, and it's refused (they can cancel for a full refund and rebook). Applying goes through the `reschedule-booking` Edge Function, which refunds first and then moves the booking (`reschedule_booking_core`, server only). `refund_cents` now accumulates, so later cancellations only refund what's still held.

### Waiver

- `waivers` (versioned; one active) and `waiver_acceptances` (who signed which version, typed name, minors covered, and how: sign up, in the app, or paper at the desk).
- Signed on the sign-up form (passed in user metadata and recorded by the `on_auth_user_created_waiver` trigger), from the Profile page, or in a prompt on the Book page. Online bookings are refused until the current version is signed (`bookings_require_waiver` trigger).
- **Admin → Waiver** (`waiver_manage`, super admin by default): edit and publish a new version (everyone re-signs before their next booking), with signature counts and recent signatures. The seeded text is a template; have a lawyer review it.
- The front desk shows "No waiver on file" and can record a paper waiver (`staff_record_waiver`).

### Booking emails

- `email_outbox` is filled by a trigger on `bookings`: a **confirmation** when a booking is confirmed (online, free with membership, or a walk-in for a customer with an account) and a **cancellation** (with the refund) when one is cancelled. **Reminders** are queued about 24 hours before a session (`email_queue_reminders`).
- The `send-emails` Edge Function sends them through Resend, every minute via `pg_cron` + `pg_net` (`20261108050100_email_cron.sql`). Several dates paid in one checkout go out as one email. Stale emails (over a day old) are skipped.
- Needs Edge Function secrets `RESEND_API_KEY` and `EMAIL_FROM` (for example `The Yard <bookings@yourdomain.com>`, on a domain verified in Resend); optional `EMAIL_REPLY_TO`. Until both are set, emails wait in the outbox.

### Reports

**Admin → Reports** (`reports_view`, super admin by default; `report_summary`): net revenue (paid minus refunds, by session date), sessions, hours booked, utilization of open hours (cages vs turf), busiest hours, revenue by payment method, top customers, memberships (active, estimated monthly recurring revenue, by tier) and new accounts. Presets or a custom range, per location or all, and a daily CSV download.

### Home screen messages

**Admin → Messages** (`announcements_manage`: ADMIN and SUPER_ADMIN): post a title and message for everyone or one location, from a start time, and choose how it goes away: users can dismiss it, it hides after a date, both, or neither (stays until archived). The Home screen shows current messages or "No new messages" (`my_announcements`, `dismiss_announcement`). Location messages show to people who've booked there in the last year or have upcoming bookings, members whose plan covers it, and its staff; while there's one location, everyone sees them.

### Admin to-dos

**Admin → To-dos** (`todos_manage`, super admin by default): a checklist for setup steps and reminders, with notes, editing and a done list (`admin_todos`).

### Errors

Edge Functions never return internal error details; they log them. In the browser, `src/lib/errors.ts` (`safeError`) shows only the friendly messages the database raises on purpose and replaces anything else with "Something went wrong".

Supabase → Edge Functions → Secrets needs `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`. The Stripe webhook endpoint is `https://cemnqswodgaqmctqbogo.supabase.co/functions/v1/stripe-webhook` with events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated` and `customer.subscription.deleted`. The Stripe customer portal must be activated (Settings → Billing → Customer portal).

Never edit a migration that has already been applied; add a new one.

Edge Functions in `supabase/functions/` are deployed by the **Deploy edge functions** workflow (`.github/workflows/functions-deploy.yml`) on pushes to `develop`, using the same `SUPABASE_ACCESS_TOKEN` secret.

## Testing

Every push and pull request runs four groups of tests in GitHub Actions (`.github/workflows/ci.yml`). On `develop`, the site, database migrations and Edge Functions deploy **only after all of them pass**; if any fail, nothing deploys and a comment is posted on the commit.

| Tests | What they cover | Run locally |
|---|---|---|
| **Database** (`supabase/tests/*.test.sql`) | Every business rule in the database: roles and privileges, prices and peak times, opening hours, overlap protection, holds, memberships and included time, waiver, refunds, front desk (walk-ins, blocks, check-in, moves and swaps, rescheduling), customer rescheduling, booking emails, messages, reports, to-dos. Runs all migrations on a fresh Postgres first. | `npm run test:db` (needs Postgres; `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`) |
| **Edge Functions** (`supabase/functions/_tests/`) | Refund rule, plan-change rules (upgrade now / downgrade at renewal), price-change renewal dates, email wording and HTML escaping; plus a type check of every function. | `deno test --node-modules-dir=none -A supabase/functions/_tests/` |
| **Unit** (`src/**/*.test.ts`) | Date/time and money helpers, opening-hours summary, safe error messages, role definitions. Plus a full TypeScript check. | `npm test` |
| **Browser** (`tests/e2e/*.spec.ts`, Playwright) | The real app against a local database and API: landing/About, sign-up waiver, access rules, signing the waiver, front desk walk-in + check-in, posting and dismissing a message, reports, and the phone menu. | `scripts/e2e-stack.sh` then `npm run test:e2e` |

Database tests use small helpers (`supabase/tests/01_helpers.sql`): `tap.ok`, `tap.is`, `tap.throws`, `tap.as_user(<id>)`, `tap.at(<weekday>, <time>)`. Each file runs in a transaction that's rolled back. The browser tests use a stand-in for the Supabase gateway (`tests/e2e/proxy.py`) in front of PostgREST; Stripe and email aren't involved.

When you add a feature, add tests in the matching place.

## Roles and privileges

Access is role- and privilege-based. The database enforces it (RLS policies and the `has_privilege`, `my_access`, `admin_list_users` and `set_user_roles` functions), and `src/auth/rbac.ts` mirrors it for the UI:

- A user has **one or more roles**; a role grants **one or more privileges**.
- The UI checks **privileges**, never roles, so changing what a role can do is a one-line change.
- Every new account gets `APP_USER` at sign up.
- A role can be assigned globally (every location) or for specific locations. `my_access` returns both, and pages marked `anyLocation` in `src/routes.tsx` open when the privilege is held for at least one location; the database then checks each location.

| Role       | Privileges                                   |
|------------|----------------------------------------------|
| `APP_USER` | `home_view`, `profile_view`, `profile_edit`, `bookings_create` |
| `LOCATION_MANAGER` | `bookings_view_all`, `bookings_manage` (all locations, or only the ones assigned on the Users page) |
| `ADMIN`    | `users_view`, `users_manage_roles`           |
| `SUPER_ADMIN` | **every privilege**, including ones added later (e.g. `locations_manage`) |

`locations_manage` (Locations pages: hours, closures, pricing, cages & turf) is not in any role yet besides `SUPER_ADMIN`; it can be granted globally or per location later (e.g. a location manager role).

Roles add up: an admin normally has both `APP_USER` and `ADMIN`. `SUPER_ADMIN` passes every privilege check no matter what other roles the user has, and only a super admin can grant or remove it.

**Users page** (`/admin/users`, needs `users_view`): lists every account with its roles. With `users_manage_roles` you can change anyone's roles, and make someone a location manager for all locations (check `LOCATION_MANAGER`) or only some (pick locations under "Location manager for"). Every user must keep at least one role, and there must always be at least one super admin. The very first account to sign up becomes super admin, so there is always someone with full access.

How access is enforced:

- **Pages:** each page in `src/routes.tsx` lists the privileges it needs. Users without them get a "No access" page, and the page is hidden from the nav bar and home launcher.
- **Features:** wrap anything in `<Can privilege={PRIVILEGES.X}>…</Can>` (also `anyOf` / `allOf`), or call `hasPrivilege()` from `useAuth()`. Example: the profile page's Edit button needs `profile_edit`.

Adding a new app or page:

1. Add its privileges (and any new role) in a new migration, and mirror them in `PRIVILEGES` / `ROLE_DEFINITIONS`.
2. Add an entry to `APP_ROUTES` in `src/routes.tsx` with its `privileges`, plus optional `nav` and `launcher` settings.

> Privilege checks in the browser only decide what the UI shows; the database makes the real decision on every request.

## Theme

Dark, electric-blue and silver, matching The Yard's facility branding. Colors live as CSS variables at the top of `src/index.css`; headings and buttons use Barlow Condensed (bold italic) and body text uses Barlow, both bundled with `@fontsource`. The home-plate logo is `src/components/Logo.tsx`.

## Project structure

```
src/
  auth/         AuthService (Supabase), AuthContext / useAuth, rbac.ts
  lib/          Supabase client
  components/   NavBar, route guards, <Can>, form field
  pages/        Landing, SignUp, SignIn, Home, Profile, Users, Forbidden, NotFound
  routes.tsx    Registry of signed-in pages and the privileges each needs
  types.ts      User and input types
.github/workflows/  deploy.yml (Pages), db-migrate.yml (Supabase)
supabase/           config.toml, migrations/
```

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds the app and deploys `dist/` to Pages on every push to `develop` (including merged PRs). PRs into `develop` run the build as a check without deploying.

One-time repo setup:

1. **Settings → Pages → Build and deployment → Source:** select **GitHub Actions**.
2. **Settings → Environments → github-pages → Deployment branches and tags:** add `develop` (by default only the default branch may deploy to Pages).

The site will be at `https://nickahrensdev.github.io/the-yard/`. If the repo is renamed, update `base` in `vite.config.ts`.
