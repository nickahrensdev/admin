# Admin

React + TypeScript front end (Vite) with a landing page, sign up / sign in, an authenticated home page and a profile page. Deployed to GitHub Pages from the `develop` branch.

## Getting started

```bash
npm install
npm run dev       # http://localhost:5173/admin/
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

Signed-in users who visit the public pages are redirected to `/home`; signed-out users who visit protected pages are sent to `/signin` and returned afterwards. The app uses `HashRouter` (`/admin/#/profile`) so refreshes and deep links work on GitHub Pages.

## Authentication

A user has a **username**, **email**, **password** and **display name**.

Pages and components only use `useAuth()` from `src/auth/AuthContext.tsx`, which delegates to an `AuthService` interface (`src/auth/authService.ts`).

> **Note:** the included `localAuthService` is a browser-only mock. Accounts are stored in `localStorage` (passwords salted and SHA-256 hashed), so they exist only in that browser and are **not secure**. GitHub Pages is static hosting, so before handling real users, implement `AuthService` against a real backend (your own API, Supabase, Firebase, Auth0, Cognito…) and pass it to `<AuthProvider service={...}>`.

## Roles and privileges

Access is role- and privilege-based (`src/auth/rbac.ts`):

- A user has **one or more roles**; a role grants **one or more privileges**.
- The UI checks **privileges**, never roles, so changing what a role can do is a one-line change.
- Every new account gets `APP_USER` at sign up.

| Role       | Privileges                                   |
|------------|----------------------------------------------|
| `APP_USER` | `home_view`, `profile_view`, `profile_edit`  |
| `ADMIN`    | `users_view`, `users_manage_roles`           |
| `SUPER_ADMIN` | **every privilege**, including ones added later |

Roles add up: an admin normally has both `APP_USER` and `ADMIN`. `SUPER_ADMIN` passes every privilege check no matter what other roles the user has, and only a super admin can grant or remove it.

**Users page** (`/admin/users`, needs `users_view`): lists every account with its roles. With `users_manage_roles` you can change anyone's roles. Every user must keep at least one role, and there must always be at least one super admin. If no super admin exists, the oldest account is made one automatically, so there is always someone with full access.

How access is enforced:

- **Pages:** each page in `src/routes.tsx` lists the privileges it needs. Users without them get a "No access" page, and the page is hidden from the nav bar and home launcher.
- **Features:** wrap anything in `<Can privilege={PRIVILEGES.X}>…</Can>` (also `anyOf` / `allOf`), or call `hasPrivilege()` from `useAuth()`. Example: the profile page's Edit button needs `profile_edit`.

Adding a new app or page:

1. Add its privileges to `PRIVILEGES` and grant them to roles in `ROLE_DEFINITIONS` (add a role if needed).
2. Add an entry to `APP_ROUTES` in `src/routes.tsx` with its `privileges`, plus optional `nav` and `launcher` settings.

> Privilege checks in the browser only decide what the UI shows. When a backend is added, it must check the same privileges on every request.

## Project structure

```
src/
  auth/         AuthService interface + mock, AuthContext / useAuth, rbac.ts
  components/   NavBar, route guards, <Can>, form field
  pages/        Landing, SignUp, SignIn, Home, Profile, Users, Forbidden, NotFound
  routes.tsx    Registry of signed-in pages and the privileges each needs
  types.ts      User and input types
.github/workflows/deploy.yml
```

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds the app and deploys `dist/` to Pages on every push to `develop` (including merged PRs). PRs into `develop` run the build as a check without deploying.

One-time repo setup:

1. **Settings → Pages → Build and deployment → Source:** select **GitHub Actions**.
2. **Settings → Environments → github-pages → Deployment branches and tags:** add `develop` (by default only the default branch may deploy to Pages).

The site will be at `https://nickahrensdev.github.io/admin/`. If the repo is renamed, update `base` in `vite.config.ts`.
