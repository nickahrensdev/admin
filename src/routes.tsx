import type { ReactNode } from 'react';
import { PRIVILEGES, type Privilege } from './auth/rbac';
import Home from './pages/Home';
import Profile from './pages/Profile';

/**
 * Registry of signed-in pages ("apps"). Each entry declares the privileges
 * it needs; routing, the nav bar and the home-page launcher are all built
 * from this list, so adding an app is one entry here.
 */
export interface AppRoute {
  path: string;
  element: ReactNode;
  /** User must have ALL of these to open the page or see it in nav/launcher. */
  privileges: Privilege[];
  /** Show in the nav bar with this label. */
  nav?: { label: string };
  /** Show as a card on the home page launcher. */
  launcher?: { title: string; description: string; cta: string };
}

export const APP_ROUTES: AppRoute[] = [
  {
    path: '/home',
    element: <Home />,
    privileges: [PRIVILEGES.HOME_VIEW],
    nav: { label: 'Home' },
  },
  {
    path: '/profile',
    element: <Profile />,
    privileges: [PRIVILEGES.PROFILE_VIEW],
    nav: { label: 'Profile' },
    launcher: {
      title: 'Your profile',
      description: 'See your account details and make changes.',
      cta: 'View profile',
    },
  },
];
