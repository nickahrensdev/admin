import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCanOpen } from '../auth/useCanOpen';
import { PRIVILEGES } from '../auth/rbac';
import { BookIcon, DeskIcon, HomeIcon, ListIcon, PersonIcon, StarIcon } from './Icons';

/**
 * Bottom tab bar for phones and tablets (hidden on wider screens by CSS). Staff get the
 * front desk in place of Membership, which moves to the More tab for them.
 */
export default function TabBar() {
  const { user, hasPrivilege } = useAuth();
  const canOpen = useCanOpen();
  if (!user) return null;

  const canBook = hasPrivilege(PRIVILEGES.BOOKINGS_CREATE);
  const isStaff = canOpen({ privileges: [PRIVILEGES.BOOKINGS_VIEW_ALL], anyLocation: true });

  const tabs = [
    { to: '/home', label: 'Home', icon: <HomeIcon /> },
    ...(canBook
      ? [
          { to: '/book', label: 'Book', icon: <BookIcon /> },
          { to: '/bookings', label: 'Bookings', icon: <ListIcon /> },
        ]
      : []),
    ...(isStaff
      ? [{ to: '/front-desk', label: 'Desk', icon: <DeskIcon /> }]
      : canBook
        ? [{ to: '/memberships', label: 'Member', icon: <StarIcon /> }]
        : []),
    { to: '/more', label: 'More', icon: <PersonIcon /> },
  ];

  return (
    <nav className="tab-bar" aria-label="Main">
      {tabs.map((t) => (
        <NavLink key={t.to} to={t.to} className="tabbar-item">
          {t.icon}
          <span>{t.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
