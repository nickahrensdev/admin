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

## Project structure

```
src/
  auth/         AuthService interface + mock, AuthContext / useAuth
  components/   NavBar, route guards, form field
  pages/        Landing, SignUp, SignIn, Home, Profile, NotFound
  types.ts      User and input types
.github/workflows/deploy.yml
```

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` builds the app and deploys `dist/` to Pages on every push to `develop` (including merged PRs). PRs into `develop` run the build as a check without deploying.

One-time repo setup:

1. **Settings → Pages → Build and deployment → Source:** select **GitHub Actions**.
2. **Settings → Environments → github-pages → Deployment branches and tags:** add `develop` (by default only the default branch may deploy to Pages).

The site will be at `https://nickahrensdev.github.io/admin/`. If the repo is renamed, update `base` in `vite.config.ts`.
