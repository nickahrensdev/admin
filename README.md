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
| `/home`    | signed in     | Home page (where users land after auth) |
| `/profile` | signed in     | Update username, email, display name, password |

Signed-in users who visit the public pages are redirected to `/home`; signed-out users who visit protected pages are sent to `/signin` and returned afterwards. The app uses `HashRouter` (`/the-yard/#/profile`) so refreshes and deep links work on GitHub Pages.

## Authentication

A user has a **username**, **email**, **password** and **display name**.

Sign-in and data live in **Supabase** (project `cemnqswodgaqmctqbogo`). Pages and components only use `useAuth()` from `src/auth/AuthContext.tsx`, which delegates to the `AuthService` interface implemented in `src/auth/authService.ts`.

- Customers sign up with username, email, display name and password, then confirm their email.
- Customers sign in with **email and password**.
- Changing email sends a confirmation link to the new address; changing password requires the current one.
- The Supabase URL and publishable key in `src/lib/supabase.ts` are public by design; the database's row level security decides what each user can read or change. **Never** put the secret/service-role key in the front end.

### Supabase dashboard settings

Under **Authentication → URL Configuration**:

- **Site URL:** `https://nickahrensdev.github.io/the-yard/`
- **Redirect URLs:** `https://nickahrensdev.github.io/the-yard/` and `http://localhost:5173/the-yard/`

## Database

Schema changes are SQL files in `supabase/migrations/`. The **Apply database migrations** workflow (`.github/workflows/db-migrate.yml`) runs `supabase db push` whenever migrations land on `develop`. It needs two repository secrets: `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`.

Tables: `profiles`, `roles`, `privileges`, `role_privileges`, `user_roles` (global or per-location), `locations`, `resources`. Location 1 is seeded with Cage 1–8 and the Turf.

Never edit a migration that has already been applied; add a new one.

## Roles and privileges

Access is role- and privilege-based. The database enforces it (RLS policies and the `has_privilege`, `my_access`, `admin_list_users` and `set_user_roles` functions), and `src/auth/rbac.ts` mirrors it for the UI:

- A user has **one or more roles**; a role grants **one or more privileges**.
- The UI checks **privileges**, never roles, so changing what a role can do is a one-line change.
- Every new account gets `APP_USER` at sign up.
- A role can be assigned globally or for one location (for location staff, coming later).

| Role       | Privileges                                   |
|------------|----------------------------------------------|
| `APP_USER` | `home_view`, `profile_view`, `profile_edit`  |
| `ADMIN`    | `users_view`, `users_manage_roles`           |
| `SUPER_ADMIN` | **every privilege**, including ones added later (e.g. `locations_manage`) |

Roles add up: an admin normally has both `APP_USER` and `ADMIN`. `SUPER_ADMIN` passes every privilege check no matter what other roles the user has, and only a super admin can grant or remove it.

**Users page** (`/admin/users`, needs `users_view`): lists every account with its roles. With `users_manage_roles` you can change anyone's roles. Every user must keep at least one role, and there must always be at least one super admin. The very first account to sign up becomes super admin, so there is always someone with full access.

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
