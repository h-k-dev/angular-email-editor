import { DateTime } from 'luxon';

import {
  daysBetween,
  isoDay,
  isoMoment,
  monthWeeks,
  parseDay,
  parseMoment,
  startOfWeek,
  weekStartOf,
} from './calendar-dates';

const local = (y: number, m: number, d: number, hour = 0, minute = 0) =>
  DateTime.local(y, m, d, hour, minute);

describe('calendar dates', () => {
  it('writes and reads days and moments, local and floating', () => {
    const date = local(2026, 10, 29, 9, 5);
    expect(isoDay(date)).toBe('2026-10-29');
    expect(isoMoment(date)).toBe('2026-10-29T09:05');
    expect(+parseMoment('2026-10-29T09:05')!).toBe(+date);
    expect(+parseDay('2026-10-29')!).toBe(+local(2026, 10, 29));
  });

  it('reads no day that is not a real one', () => {
    expect(parseDay('2026-02-30')).toBeNull();
    expect(parseDay('2026-10-29T09:00')).toBeNull();
    expect(parseDay('tomorrow')).toBeNull();
    expect(parseMoment('2026-10-29T24:00')).toBeNull();
  });

  it('counts by the calendar, not by 24-hour steps', () => {
    // Europe's clocks go back on 2026-10-25; a day is still a day.
    expect(isoDay(local(2026, 10, 24).plus({ days: 2 }))).toBe('2026-10-26');
    expect(daysBetween(local(2026, 10, 24, 23), local(2026, 10, 26, 1))).toBe(2);
  });

  it('starts a week on the language’s day', () => {
    const thursday = local(2026, 10, 29);
    expect(isoDay(startOfWeek(thursday, weekStartOf('en')))).toBe('2026-10-25');
    expect(isoDay(startOfWeek(thursday, weekStartOf('de')))).toBe('2026-10-26');
    expect(isoDay(startOfWeek(local(2026, 10, 25), 1))).toBe('2026-10-19');
  });

  it('gives a month every week that holds one of its days, whole', () => {
    const october = monthWeeks(local(2026, 10, 29), 7);
    expect(october.length).toBe(5);
    expect(october[0][0]).toBe('2026-09-27');
    expect(october.at(-1)!.at(-1)).toBe('2026-10-31');
    // February 2026 starts on a Sunday and has 28 days: four weeks.
    expect(monthWeeks(local(2026, 2, 1), 7).length).toBe(4);
    expect(monthWeeks(local(2026, 8, 1), 7).length).toBe(6);
  });
});
