import { toUtcDateOnly } from './kyc.date';

/**
 * Regression tests for the date-of-birth timezone bug: a DOB must always be
 * persisted at 00:00 UTC of the day the user picked, whatever timezone
 * serialised it.
 */
describe('toUtcDateOnly', () => {
  it('keeps a date-only string as the same UTC day', () => {
    const result = toUtcDateOnly('1984-06-10');
    expect(result.toISOString()).toBe('1984-06-10T00:00:00.000Z');
  });

  it('keeps a UTC-midnight timestamp unchanged', () => {
    const result = toUtcDateOnly('1984-06-10T00:00:00.000Z');
    expect(result.toISOString()).toBe('1984-06-10T00:00:00.000Z');
  });

  it('keeps the calendar day of an ISO timestamp', () => {
    const result = toUtcDateOnly('1984-06-10T05:30:00.000Z');
    expect(result.toISOString()).toBe('1984-06-10T00:00:00.000Z');
  });

  it('ignores the time component entirely', () => {
    const result = toUtcDateOnly(new Date('1999-12-31T23:59:59.000Z'));
    expect(result.toISOString()).toBe('1999-12-31T00:00:00.000Z');
  });

  it('handles leap days', () => {
    const result = toUtcDateOnly('2000-02-29');
    expect(result.toISOString()).toBe('2000-02-29T00:00:00.000Z');
  });
});
