import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useCanOpen } from '../auth/useCanOpen';
import { PRIVILEGES } from '../auth/rbac';
import { myWaiverStatus, type WaiverStatus } from '../data/waiver';
import { myMembership, type MyMembership } from '../data/memberships';
import { APP_ROUTES } from '../routes';
import { initials } from '../utils/initials';
import { ChevronRight } from '../components/Icons';

/** Everything that isn't a tab: account, facility info, staff and admin tools, sign out. */
export default function More() {
  const { user, signOut, hasPrivilege } = useAuth();
  const canOpen = useCanOpen();
  const navigate = useNavigate();
  const [waiver, setWaiver] = useState<WaiverStatus | null>(null);
  const [membership, setMembership] = useState<MyMembership | null>(null);

  const canBook = hasPrivilege(PRIVILEGES.BOOKINGS_CREATE);
  const isStaff = canOpen({ privileges: [PRIVILEGES.BOOKINGS_VIEW_ALL], anyLocation: true });
  const admin = APP_ROUTES.filter((r) => r.nav?.group === 'admin' && canOpen(r));

  useEffect(() => {
    myWaiverStatus().then(setWaiver).catch(() => undefined);
    if (canBook) myMembership().then(setMembership).catch(() => undefined);
  }, [canBook]);

  if (!user) return null;
  const member = membership && (membership.status === 'active' || membership.status === 'past_due') ? membership : null;

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <section className="more">
      <div className="more-head">
        <span className="avatar avatar-lg" aria-hidden="true">{initials(user.displayName)}</span>
        <div className="more-who">
          <strong>{user.displayName}</strong>
          <span className="muted">@{user.username}{member ? ` · ${member.tier.name} member` : ''}</span>
        </div>
        <Link to="/profile" className="more-edit">Edit</Link>
      </div>

      <h2 className="list-title">Account</h2>
      <div className="list-group">
        <Row to="/profile" label="Profile & contact" value={user.email ?? undefined} />
        {waiver && (
          <Row
            to="/profile"
            label="Waiver"
            value={!waiver.required ? 'Not needed' : waiver.signed ? `Signed ${waiver.last_signed_at ? new Date(waiver.last_signed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}` : 'Not signed'}
            tone={waiver.required && !waiver.signed ? 'warn' : 'ok'}
          />
        )}
        {canBook && <Row to="/memberships" label="Membership & billing" value={member ? member.tier.name : 'Not a member'} />}
      </div>

      <h2 className="list-title">The Yard</h2>
      <div className="list-group">
        <Row to="/about" label="Hours, prices & policies" />
        <Row to="/about" label="About The Yard" />
      </div>

      {isStaff && (
        <>
          <h2 className="list-title">Staff</h2>
          <div className="list-group">
            <Row to="/front-desk" label="Front desk" />
          </div>
        </>
      )}

      {admin.length > 0 && (
        <>
          <h2 className="list-title">Admin</h2>
          <div className="list-group">
            {admin.map((r) => (
              <Row key={r.path} to={r.path} label={r.nav!.label} />
            ))}
          </div>
        </>
      )}

      <button className="btn btn-ghost btn-block more-signout" onClick={handleSignOut}>Sign out</button>
      {(isStaff || admin.length > 0) && (
        <p className="muted small center more-build">Version {__BUILD_SHA__} · {new Date(__BUILD_TIME__).toLocaleString()}</p>
      )}
    </section>
  );
}

function Row({ to, label, value, tone }: { to: string; label: string; value?: string; tone?: 'ok' | 'warn' }) {
  return (
    <Link to={to} className="list-row">
      <span className="list-label">{label}</span>
      {value && <span className={`list-value${tone ? ` is-${tone}` : ''}`}>{value}</span>}
      <ChevronRight />
    </Link>
  );
}
