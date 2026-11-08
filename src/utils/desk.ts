import type { StaffBooking } from '../data/staff';

/** A walk-in with money still to collect at the desk. */
export function toCollect(b: StaffBooking): boolean {
  return b.kind === 'walk_in' && b.status === 'confirmed' && b.total_cents > 0 && b.payment_method !== 'comp' && !b.paid_at;
}

/** Minutes late: started 10+ minutes ago, not checked in or marked, and not over yet (0 otherwise). */
export function minutesLate(b: StaffBooking, now = Date.now()): number {
  if (b.kind === 'block' || b.status !== 'confirmed' || b.checked_in_at || b.no_show) return 0;
  const late = Math.floor((now - Date.parse(b.starts_at)) / 60_000);
  return late >= 10 ? late : 0;
}

/** Search a day's bookings by name, username, email, phone or note. */
export function matchesSearch(b: StaffBooking, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  const digits = t.replace(/\D/g, '');
  const hay = [b.customer?.display_name, b.customer?.username, b.customer?.email, b.guest_name, b.note].filter(Boolean).join(' ').toLowerCase();
  const phones = [b.customer?.phone, b.guest_phone].filter(Boolean).join(' ').replace(/\D/g, '');
  return hay.includes(t) || (digits.length >= 3 && phones.includes(digits));
}

/** "Checked in", "Moved Cage 1 → Cage 5", … for the activity log. */
export function describeEvent(e: { action: string; details: Record<string, unknown> }, tz?: string): string {
  const d = e.details as Record<string, string | number | null>;
  const money = (c: unknown) => `$${(Number(c ?? 0) / 100).toFixed(2)}`;
  const t = (iso: unknown) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(String(iso)));
  switch (e.action) {
    case 'created':
      return d.kind === 'block' ? 'Blocked the time' : d.kind === 'walk_in' ? `Booked a walk-in${Number(d.total_cents) ? ` (${money(d.total_cents)})` : ''}` : 'Started an online booking';
    case 'confirmed': return `Paid online${Number(d.total_cents) ? ` (${money(d.total_cents)})` : ''}`;
    case 'cancelled': return `Cancelled${Number(d.refund_cents) ? `, refunded ${money(d.refund_cents)}` : ''}`;
    case 'refunded': return `Refunded ${money(d.refund_cents)}`;
    case 'rescheduled': return `Moved to ${t(d.to_start)}${d.from_cents !== d.to_cents ? ` (${money(d.from_cents)} → ${money(d.to_cents)})` : ''}`;
    case 'moved': return `Moved ${d.from} → ${d.to}`;
    case 'checked_in': return 'Checked in';
    case 'check_in_undone': return 'Undid check-in';
    case 'no_show': return 'Marked no-show';
    case 'no_show_undone': return 'Undid no-show';
    case 'paid': return `Collected ${money(d.total_cents)} by ${d.method ?? 'cash'}`;
    case 'payment_undone': return 'Undid payment';
    default: return e.action;
  }
}
