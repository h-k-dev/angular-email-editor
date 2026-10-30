import { DateTime, Info, WeekdayNumbers } from 'luxon';

/**
 * The calendar's dates: Luxon `DateTime`s in the browser's zone, written as
 * ISO strings so they go into a URL (`/calendar/week/2026-10-29`), into
 * storage and into an iCalendar `DTSTART` alike. A day is `yyyy-MM-dd`; a
 * moment is `yyyy-MM-ddTHH:mm` — a floating time, read in whatever zone the
 * browser is in, as Google Calendar shows one. Luxon does the calendar's
 * arithmetic (a day is a day across a clock change, Jan 31 + 1 month is
 * Feb 28); this file only fixes the two string shapes and the grids built
 * from them.
 */

/** A day, `yyyy-MM-dd`. */
export type IsoDay = string;

/** A moment, `yyyy-MM-ddTHH:mm`, local. */
export type IsoMoment = string;

/** The first day of a week, Luxon's (and ISO 8601's): 1 Monday … 7 Sunday. */
export type WeekStart = WeekdayNumbers;

/** Minutes in a day. */
export const DAY_MINUTES = 24 * 60;

const DAY_FORMAT = 'yyyy-MM-dd';
const MOMENT_FORMAT = "yyyy-MM-dd'T'HH:mm";

/** `date`'s day, `yyyy-MM-dd`. */
export function isoDay(date: DateTime): IsoDay {
  return date.toFormat(DAY_FORMAT);
}

/** `date`'s moment, `yyyy-MM-ddTHH:mm`. */
export function isoMoment(date: DateTime): IsoMoment {
  return date.toFormat(MOMENT_FORMAT);
}

/** `value` read by `format` — only where it writes back the same: Luxon
    takes `24:00` for the next midnight, and the calendar does not. */
function strict(value: string | null | undefined, format: string): DateTime | null {
  const date = DateTime.fromFormat(value ?? '', format);
  return date.isValid && date.toFormat(format) === value ? date : null;
}

/** The day a string names, at midnight — or null for anything that is not
    a real day (`2026-02-30` is not one). */
export function parseDay(value: string | null | undefined): DateTime | null {
  return strict(value, DAY_FORMAT);
}

/** The moment a string names — or null for anything that is not one. */
export function parseMoment(value: string | null | undefined): DateTime | null {
  return strict(value, MOMENT_FORMAT);
}

/** The first day of `date`'s week. */
export function startOfWeek(date: DateTime, weekStart: WeekStart): DateTime {
  const day = date.startOf('day');
  return day.minus({ days: (day.weekday - weekStart + 7) % 7 });
}

/** Whole days from `from` to `to`, by the calendar. */
export function daysBetween(from: DateTime, to: DateTime): number {
  return Math.round(to.startOf('day').diff(from.startOf('day'), 'days').days);
}

/** `count` days from `from`, as days. */
export function dayRange(from: DateTime, count: number): IsoDay[] {
  return Array.from({ length: count }, (_, i) => isoDay(from.plus({ days: i })));
}

/** The weeks a month view shows: every week that holds a day of `date`'s
    month, whole — four to six of them, as many as the month needs. */
export function monthWeeks(date: DateTime, weekStart: WeekStart): IsoDay[][] {
  const last = date.endOf('month');
  const weeks: IsoDay[][] = [];
  for (
    let start = startOfWeek(date.startOf('month'), weekStart);
    start <= last;
    start = start.plus({ weeks: 1 })
  ) {
    weeks.push(dayRange(start, 7));
  }
  return weeks;
}

/** `count` whole weeks from the first week of `date`'s month — a picker's
    grid that keeps its height whichever month it shows (the mini month's
    seven), the next month's first days filling the rest. */
export function fixedWeeks(date: DateTime, weekStart: WeekStart, count: number): IsoDay[][] {
  const first = startOfWeek(date.startOf('month'), weekStart);
  return Array.from({ length: count }, (_, i) => dayRange(first.plus({ weeks: i }), 7));
}

/** Minutes since midnight — by the clock: 7:15 is 435, even on the day
    the clocks change. */
export function minuteOfDay(date: DateTime): number {
  return date.hour * 60 + date.minute;
}

/**
 * The moment at `minute` past midnight on `day` — by the clock, as a grid
 * row reads it: 435 is 7:15. Never `plus({ minutes })`: that counts time
 * passed, and on the day the clocks change (Europe's go back on
 * 2026-10-25) 435 minutes after midnight is 6:15. `DAY_MINUTES` is the
 * next midnight.
 */
export function atMinute(day: DateTime, minute: number): DateTime {
  const midnight = day.startOf('day');
  if (minute >= DAY_MINUTES) return midnight.plus({ days: 1 });
  return midnight.set({ hour: Math.floor(minute / 60), minute: minute % 60 });
}

/** `atMinute`'s inverse: how far into `day` `moment` is, by the clock —
    beyond `DAY_MINUTES` on a later day, below 0 on an earlier one. */
export function minutesInto(day: DateTime, moment: DateTime): number {
  return daysBetween(day, moment) * DAY_MINUTES + minuteOfDay(moment);
}

/** `minutes` rounded to the nearest `step`. */
export function snapMinutes(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step;
}

/** The week a language starts on, as its calendars print it — the
    locale's own week (Sunday in English and Japanese, Monday in German),
    which Luxon reads from `Intl.Locale`'s week info. */
export function weekStartOf(language: string): WeekStart {
  return Info.getStartOfWeek({ locale: language });
}
