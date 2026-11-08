import { describe, expect, it, vi } from 'vitest';
import { safeError } from './errors';

describe('safeError', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);

  it('shows messages the database raises on purpose', () => {
    expect(safeError({ code: '22023', message: 'Pick a start time.' }).message).toBe('Pick a start time.');
    expect(safeError({ code: 'P0001', message: 'Custom' }).message).toBe('Custom');
    expect(safeError({ code: '23P01', message: 'Cage 3 is already booked on Tue Nov 17.' }).message).toMatch(/Cage 3/);
  });

  it('hides internal details', () => {
    expect(safeError({ code: '23505', message: 'duplicate key value violates unique constraint "x_pkey"' }).message).toBe(
      'Something went wrong. Please try again.',
    );
    expect(safeError({ code: '42883', message: 'function public.foo() does not exist' }).message).not.toMatch(/public/);
    expect(safeError({ code: '23P01', message: 'conflicting key value violates exclusion constraint "booking_items_no_overlap"' }).message).toBe(
      'That time was just taken. Pick another time.',
    );
    expect(safeError({ code: '42501', message: 'permission denied for function staff_day' }).message).toBe("You don't have permission to do that.");
  });
});
