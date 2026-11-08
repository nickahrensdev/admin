import type { ReactNode } from 'react';
import { PRIVILEGES, type Privilege } from './auth/rbac';
import Book from './pages/Book';
import Home from './pages/Home';
import MyBookings from './pages/MyBookings';
import Memberships from './pages/Memberships';
import AdminMemberships from './pages/AdminMemberships';
import Profile from './pages/Profile';
import FrontDesk from './pages/staff/FrontDesk';
import AdminWaiver from './pages/admin/AdminWaiver';
import Reports from './pages/admin/Reports';
import Todos from './pages/admin/Todos';
import Announcements from './pages/admin/Announcements';
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
  /** Privileges given for specific locations count too; the page itself checks each location. */
  anyLocation?: boolean;
  /** Show in the nav bar with this label. `group: 'admin'` puts it in the Admin menu;
   *  `mobileOnly` hides it on desktop (where the logo / your name already link there). */
  nav?: { label: string; group?: 'admin'; mobileOnly?: boolean };
  /** Show as a card on the home page launcher. */
  launcher?: { title: string; description: string; cta: string };
}

export const APP_ROUTES: AppRoute[] = [
  {
    path: '/home',
    element: <Home />,
    privileges: [PRIVILEGES.HOME_VIEW],
    nav: { label: 'Home', mobileOnly: true },
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
    path: '/memberships',
    element: <Memberships />,
    privileges: [PRIVILEGES.BOOKINGS_CREATE],
    nav: { label: 'Membership' },
    launcher: {
      title: 'Membership',
      description: 'Included cage time every month, member pricing and a 90-day booking window.',
      cta: 'See memberships',
    },
  },
  {
    path: '/front-desk',
    element: <FrontDesk />,
    privileges: [PRIVILEGES.BOOKINGS_VIEW_ALL],
    anyLocation: true,
    nav: { label: 'Front desk' },
    launcher: {
      title: 'Front desk',
      description: 'Today’s schedule, check-in, walk-ins and blocked time.',
      cta: 'Open front desk',
    },
  },
  {
    path: '/profile',
    element: <Profile />,
    privileges: [PRIVILEGES.PROFILE_VIEW],
    nav: { label: 'Profile', mobileOnly: true },
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
    nav: { label: 'Users', group: 'admin' },
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
    nav: { label: 'Locations', group: 'admin' },
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
  {
    path: '/admin/memberships',
    element: <AdminMemberships />,
    privileges: [PRIVILEGES.MEMBERSHIPS_MANAGE],
    nav: { label: 'Membership tiers', group: 'admin' },
    launcher: {
      title: 'Membership tiers',
      description: 'Set tier prices and benefits per location, and see members.',
      cta: 'Manage tiers',
    },
  },
  {
    path: '/admin/waiver',
    element: <AdminWaiver />,
    privileges: [PRIVILEGES.WAIVER_MANAGE],
    nav: { label: 'Waiver', group: 'admin' },
    launcher: {
      title: 'Waiver',
      description: 'Edit the liability waiver and see who has signed.',
      cta: 'Manage waiver',
    },
  },
  {
    path: '/admin/reports',
    element: <Reports />,
    privileges: [PRIVILEGES.REPORTS_VIEW],
    nav: { label: 'Reports', group: 'admin' },
    launcher: {
      title: 'Reports',
      description: 'Revenue, bookings, utilization, busiest times and memberships.',
      cta: 'View reports',
    },
  },
  {
    path: '/admin/todos',
    element: <Todos />,
    privileges: [PRIVILEGES.TODOS_MANAGE],
    nav: { label: 'To-dos', group: 'admin' },
    launcher: {
      title: 'To-dos',
      description: 'Setup steps and reminders for things still to do.',
      cta: 'Open to-dos',
    },
  },
  {
    path: '/admin/messages',
    element: <Announcements />,
    privileges: [PRIVILEGES.ANNOUNCEMENTS_MANAGE],
    nav: { label: 'Messages', group: 'admin' },
    launcher: {
      title: 'Messages',
      description: 'Post messages on customers’ Home screens, for everyone or one location.',
      cta: 'Manage messages',
    },
  },
];
