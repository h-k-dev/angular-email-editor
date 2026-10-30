import { DateTime } from 'luxon';

import {
  atMinute,
  daysBetween,
  fixedWeeks,
  isoDay,
  isoMoment,
  minutesInto,
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

  it('reads a row’s minute by the clock — on the day the clocks change too', () => {
    // Europe's clocks go back an hour at 3:00 on 2026-10-25: the day has 25
    // hours, and 435 minutes after midnight is 6:15 on the clock.
    const zone = 'Europe/Berlin';
    const changeDay = DateTime.fromISO('2026-10-25', { zone });
    const quarter = atMinute(changeDay, 435);
    expect(quarter.toFormat('yyyy-MM-dd HH:mm')).toBe('2026-10-25 07:15');
    expect(minutesInto(changeDay, quarter)).toBe(435);
    // An ordinary day reads the same; the end is the next midnight.
    expect(atMinute(DateTime.fromISO('2026-10-29', { zone }), 570).toFormat('HH:mm')).toBe('09:30');
    expect(atMinute(changeDay, 1440).toISODate()).toBe('2026-10-26');
    // Into a later day, past the day's minutes.
    expect(minutesInto(changeDay, DateTime.fromISO('2026-10-26T01:00', { zone }))).toBe(1500);
  });

  it('starts a week on the language’s day', () => {
    const thursday = local(2026, 10, 29);
    expect(isoDay(startOfWeek(thursday, weekStartOf('en')))).toBe('2026-10-25');
    expect(isoDay(startOfWeek(thursday, weekStartOf('de')))).toBe('2026-10-26');
    expect(isoDay(startOfWeek(local(2026, 10, 25), 1))).toBe('2026-10-19');
  });

  it('gives a picker seven weeks whatever the month: the same height every turn', () => {
    const october = fixedWeeks(local(2026, 10, 29), 7, 7);
    expect(october.length).toBe(7);
    expect(october[0][0]).toBe('2026-09-27');
    expect(october.at(-1)!.at(-1)).toBe('2026-11-14');
    // February 2026 needs four: three more of March.
    expect(fixedWeeks(local(2026, 2, 1), 7, 7).map((week) => week[0])).toEqual([
      '2026-02-01',
      '2026-02-08',
      '2026-02-15',
      '2026-02-22',
      '2026-03-01',
      '2026-03-08',
      '2026-03-15',
    ]);
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
