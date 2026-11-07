import type { ReactNode } from 'react';
import { PRIVILEGES, type Privilege } from './auth/rbac';
import Book from './pages/Book';
import Home from './pages/Home';
import MyBookings from './pages/MyBookings';
import Profile from './pages/Profile';
import Users from './pages/Users';
import LocationDetail from './pages/locations/LocationDetail';
import LocationsList from './pages/locations/LocationsList';

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
    path: '/book',
    element: <Book />,
    privileges: [PRIVILEGES.BOOKINGS_CREATE],
    nav: { label: 'Book' },
    launcher: {
      title: 'Book a cage',
      description: 'Reserve batting cages or the turf in 30-minute blocks.',
      cta: 'Book now',
    },
  },
  {
    path: '/bookings',
    element: <MyBookings />,
    privileges: [PRIVILEGES.BOOKINGS_CREATE],
    nav: { label: 'My bookings' },
    launcher: {
      title: 'My bookings',
      description: 'See upcoming sessions, or cancel and get refunded.',
      cta: 'View bookings',
    },
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
  {
    path: '/admin/users',
    element: <Users />,
    privileges: [PRIVILEGES.USERS_VIEW],
    nav: { label: 'Users' },
    launcher: {
      title: 'Users',
      description: 'View every account and assign roles.',
      cta: 'Manage users',
    },
  },
  {
    path: '/admin/locations',
    element: <LocationsList />,
    privileges: [PRIVILEGES.LOCATIONS_MANAGE],
    nav: { label: 'Locations' },
    launcher: {
      title: 'Locations',
      description: 'Set hours, holidays and closures, prices and peak times, and cages and turf.',
      cta: 'Manage locations',
    },
  },
  {
    path: '/admin/locations/:id',
    element: <LocationDetail />,
    privileges: [PRIVILEGES.LOCATIONS_MANAGE],
  },
];
