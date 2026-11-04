import { DateTime } from 'luxon';

import { calendarFormats, eventClipboardLine, parseEventClipboardLine } from './calendar-format';

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

describe('eventClipboardLine — Notion Calendar’s copied line', () => {
  const line = (start: string, end: string, allDay = false) =>
    eventClipboardLine({ start, end, allDay }, 'asd');

  it('writes a timed event as Notion does', () => {
    expect(line('2026-11-03T06:45', '2026-11-03T09:15')).toBe(
      'asd on Nov 3, 2026 at 6:45 AM - 9:15 AM',
    );
    expect(line('2026-11-03T12:00', '2026-11-04T00:00')).toBe(
      'asd on Nov 3, 2026 at 12:00 PM - 12:00 AM',
    );
  });

  it('names the end’s day past midnight', () => {
    expect(line('2026-11-03T22:00', '2026-11-04T01:00')).toBe(
      'asd on Nov 3, 2026 at 10:00 PM - Nov 4, 2026 at 1:00 AM',
    );
  });

  it('writes all-day events by their days, the last one held', () => {
    expect(line('2026-11-03T00:00', '2026-11-04T00:00', true)).toBe('asd on Nov 3, 2026');
    expect(line('2026-11-03T00:00', '2026-11-06T00:00', true)).toBe(
      'asd on Nov 3, 2026 - Nov 5, 2026',
    );
  });
});

describe('parseEventClipboardLine — Notion Calendar’s line read back', () => {
  const read = parseEventClipboardLine;

  it('reads every form the copy writes, back to the same event', () => {
    const events = [
      { start: '2026-11-03T06:45', end: '2026-11-03T09:15', allDay: false },
      { start: '2026-11-03T12:00', end: '2026-11-04T00:00', allDay: false },
      { start: '2026-11-03T22:00', end: '2026-11-04T01:00', allDay: false },
      { start: '2026-11-03T22:00', end: '2026-11-05T01:00', allDay: false },
      { start: '2026-11-03T00:00', end: '2026-11-04T00:00', allDay: true },
      { start: '2026-11-03T00:00', end: '2026-11-06T00:00', allDay: true },
    ];
    for (const event of events) {
      expect(read(eventClipboardLine(event, 'asd'))).toEqual({ title: 'asd', ...event });
    }
  });

  it('reads Notion’s own line', () => {
    expect(read('asd on Nov 3, 2026 at 6:45 AM - 9:15 AM')).toEqual({
      title: 'asd',
      start: '2026-11-03T06:45',
      end: '2026-11-03T09:15',
      allDay: false,
    });
  });

  it('keeps " on " in a title, an end before its start the next day’s, none an hour', () => {
    expect(read('Sign off on budget on Nov 3, 2026')?.title).toBe('Sign off on budget');
    expect(read('Late on Nov 3, 2026 at 10:00 PM - 1:00 AM')?.end).toBe('2026-11-04T01:00');
    expect(read('Call on Nov 3, 2026 at 9:00 AM')?.end).toBe('2026-11-03T10:00');
    // Intl's narrow no-break space before the meridiem.
    expect(read('Call on Nov 3, 2026 at 9:00\u202fAM')?.start).toBe('2026-11-03T09:00');
  });

  it('reads nothing from other words', () => {
    expect(read('just some words')).toBeNull();
    expect(read('asd on Nob 3, 2026')).toBeNull();
    expect(read('asd on Nov 3, 2026 - Nov 1, 2026')).toBeNull();
    expect(read('asd\nDienstag, 3. November · 06:00–07:00 Uhr')).toBeNull();
  });
});
