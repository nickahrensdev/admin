/**
 * Turns a database/API error into something safe to show customers.
 *
 * The database raises friendly, customer-facing messages on purpose (for
 * example "Cage 3 is already booked on Tue Nov 17"). Those use the codes
 * below and are shown as-is. Anything else (constraint names, SQL errors,
 * network failures) is logged to the console and replaced with a generic
 * message, so internal details never reach the screen.
 */
const INTENDED = new Set(['P0001', '22023', 'P0002', '23P01']);

export function safeError(error: { message?: string; code?: string } | null | undefined, fallback = 'Something went wrong. Please try again.'): Error {
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  if (code === '42501') {
    // Raised by our own checks with a friendly message, or by Postgres ("permission denied for …").
    return new Error(/permission denied/i.test(message) ? "You don't have permission to do that." : message);
  }
  if (code === '23P01' && /exclusion constraint/i.test(message)) return new Error('That time was just taken. Pick another time.');
  if (INTENDED.has(code) && message) return new Error(message);
  console.error('Request failed', error);
  return new Error(fallback);
}
