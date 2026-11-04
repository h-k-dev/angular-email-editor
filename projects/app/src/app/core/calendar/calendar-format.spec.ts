import { DateTime } from 'luxon';

import { calendarFormats } from './calendar-format';

describe('calendarFormats — duration', () => {
  const at = (iso: string) => DateTime.fromISO(iso);
  const { duration } = calendarFormats('en');

  it('says how long, narrow, the units that are none left out', () => {
    expect(duration(at('2027-01-06T10:45'), at('2027-01-06T12:30'))).toBe('1h 45m');
    expect(duration(at('2027-01-06T10:00'), at('2027-01-06T12:00'))).toBe('2h');
    expect(duration(at('2027-01-06T10:00'), at('2027-01-06T10:15'))).toBe('15m');
    expect(duration(at('2027-01-03T10:45'), at('2027-01-09T21:30'))).toBe('6d 10h 45m');
  });

  it('says a moment as none, not nothing', () => {
    expect(duration(at('2027-01-06T10:00'), at('2027-01-06T10:00'))).toBe('0m');
  });

  it('counts the real hours across a clock change', () => {
    // Europe's spring forward: 01:00 → 04:00 on the clock is two real
    // hours — what the event lasts.
    const berlin = { zone: 'Europe/Berlin' };
    const from = DateTime.fromISO('2027-03-28T01:00', berlin);
    const to = DateTime.fromISO('2027-03-28T04:00', berlin);
    expect(duration(from, to)).toBe('2h');
  });
});
