import { Service, computed, inject } from '@angular/core';
import { DateTime, DateTimeFormatOptions, Duration, Interval } from 'luxon';

import { I18n } from '../translations/i18n';
import { WeekStart, isoMoment, weekStartOf } from './calendar-dates';
import { CalendarEvent, DEFAULT_EVENT_MINUTES, eventSpan } from './calendar-event';

/** How a calendar writes its dates and times in one language. */
export interface CalendarFormats {
  readonly language: string;
  readonly weekStart: WeekStart;
  /** "October 2026" — or "Oct – Nov 2026" for a run across two months. */
  title(from: DateTime, to: DateTime): string;
  /** "Thursday, October 29, 2026". */
  longDay(date: DateTime): string;
  /** "Thu". */
  weekday(date: DateTime): string;
  /** "T" — the mini month's column heads. */
  narrowWeekday(date: DateTime): string;
  /** "10 AM", "10:30 AM" — the hour alone when the minutes are none. */
  time(date: DateTime): string;
  /** "Oct 29". */
  shortDay(date: DateTime): string;
  /** "10:00 – 11:00 AM" — a timed event's two times. */
  timeRange(start: DateTime, end: DateTime): string;
  /** "Oct 27, 3:00 PM – Oct 29, 10:30 AM" — two times on different days. */
  dayTimeRange(start: DateTime, end: DateTime): string;
  /** When an event is, in a line: "Thursday, October 29 · 10:00 – 11:00 AM",
      "Thursday, October 29" all day, "October 29 – 31" over days. */
  when(event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>): string;
  /** How long from one to the other, narrow: "1h 45m", "6d 10h 45m" —
      the units that are none left out. */
  duration(start: DateTime, end: DateTime): string;
}

/** `Intl.DurationFormat` (ES2025 — past this project's lib): where the
    browser has it, a duration's own words; else Luxon's list of units. */
type DurationFormatter = new (
  language: string,
  options: { style: 'narrow' },
) => { format(duration: Record<string, number>): string };
const DurationFormat = (Intl as unknown as { DurationFormat?: DurationFormatter }).DurationFormat;

const MONTH_YEAR: DateTimeFormatOptions = { month: 'long', year: 'numeric' };
const SHORT_MONTH_YEAR: DateTimeFormatOptions = { month: 'short', year: 'numeric' };
const LONG_DAY: DateTimeFormatOptions = {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
};
const DAY_OF_WEEK: DateTimeFormatOptions = { weekday: 'long', month: 'long', day: 'numeric' };
const MONTH_DAY: DateTimeFormatOptions = { month: 'long', day: 'numeric' };
const SHORT_DAY: DateTimeFormatOptions = { month: 'short', day: 'numeric' };
const HOUR: DateTimeFormatOptions = { hour: 'numeric' };
const HOUR_MINUTE: DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
const DAY_TIME: DateTimeFormatOptions = { ...MONTH_DAY, ...HOUR_MINUTE };
const SHORT_DAY_TIME: DateTimeFormatOptions = { ...SHORT_DAY, ...HOUR_MINUTE };

/** A language's formats — pure: the view's language in, its words out.
    Luxon writes them through `Intl`, a range through its `formatRange`. */
export function calendarFormats(language: string): CalendarFormats {
  const locale = { locale: language };
  const one = (date: DateTime, options: DateTimeFormatOptions) =>
    date.toLocaleString(options, locale);
  const range = (from: DateTime, to: DateTime, options: DateTimeFormatOptions) =>
    Interval.fromDateTimes(from, to).toLocaleString(options, locale);
  const timeRange = (start: DateTime, end: DateTime) => range(start, end, HOUR_MINUTE);
  const narrow = DurationFormat ? new DurationFormat(language, { style: 'narrow' }) : null;

  return {
    language,
    weekStart: weekStartOf(language),
    title: (from, to) =>
      from.hasSame(to, 'month') ? one(from, MONTH_YEAR) : range(from, to, SHORT_MONTH_YEAR),
    longDay: (date) => one(date, LONG_DAY),
    weekday: (date) => one(date, { weekday: 'short' }),
    narrowWeekday: (date) => one(date, { weekday: 'narrow' }),
    time: (date) => one(date, date.minute ? HOUR_MINUTE : HOUR),
    shortDay: (date) => one(date, SHORT_DAY),
    timeRange,
    dayTimeRange: (start, end) => range(start, end, SHORT_DAY_TIME),
    when: (event) => {
      const { start, end } = eventSpan(event);
      if (event.allDay) {
        // The exclusive end's day before: the last day it holds.
        const last = end.minus({ days: 1 });
        return last > start ? range(start, last, MONTH_DAY) : one(start, DAY_OF_WEEK);
      }
      return start.hasSame(end.minus({ milliseconds: 1 }), 'day')
        ? `${one(start, DAY_OF_WEEK)} · ${timeRange(start, end)}`
        : range(start, end, DAY_TIME);
    },
    duration: (start, end) => {
      const units = end.diff(start, ['days', 'hours', 'minutes']).removeZeros().toObject();
      const span = Duration.fromObject(Object.keys(units).length ? units : { minutes: 0 });
      // None at all (a moment): Intl leaves out every unit and says
      // nothing — Luxon says "0m".
      return (
        narrow?.format(span.toObject() as Record<string, number>) ||
        span.reconfigure(locale).toHuman({ unitDisplay: 'narrow' })
      );
    },
  };
}

const COPY_LOCALE = { locale: 'en-US' };
const copyDay = (date: DateTime) => date.toFormat('MMM d, yyyy', COPY_LOCALE);
const copyTime = (date: DateTime) => date.toFormat('h:mm a', COPY_LOCALE);

/**
 * An event as a line on the clipboard, Notion Calendar's, word for word —
 * English whatever the app's language, so either side reads the other's:
 * "Coffee on Nov 3, 2026 at 6:45 AM - 9:15 AM", "Coffee on Nov 3, 2026"
 * all day, "… on Nov 3, 2026 - Nov 5, 2026" over days,
 * "… on Nov 3, 2026 at 10:00 PM - Nov 4, 2026 at 1:00 AM" past midnight.
 */
export function eventClipboardLine(
  event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>,
  title: string,
): string {
  const { start, end } = eventSpan(event);
  if (event.allDay) {
    // The exclusive end's day before: the last day it holds.
    const last = end.minus({ days: 1 });
    const days = last > start ? `${copyDay(start)} - ${copyDay(last)}` : copyDay(start);
    return `${title} on ${days}`;
  }
  const until = start.hasSame(end.minus({ milliseconds: 1 }), 'day')
    ? copyTime(end)
    : `${copyDay(end)} at ${copyTime(end)}`;
  return `${title} on ${copyDay(start)} at ${copyTime(start)} - ${until}`;
}

/** What a copied line says: a title and when — the rest is the paste's. */
export type CopiedEvent = Pick<CalendarEvent, 'title' | 'start' | 'end' | 'allDay'>;

const DAY_WORDS = '([A-Z][a-z]{2} \\d{1,2}, \\d{4})';
const TIME_WORDS = '(\\d{1,2}:\\d{2} [AP]M)';
/** Every form `eventClipboardLine` writes; the title is all before the
    last " on " a day follows. */
const LINE = new RegExp(
  `^(.*) on ${DAY_WORDS}(?: at ${TIME_WORDS})?` +
    `(?: - (?:${DAY_WORDS}(?: at ${TIME_WORDS})?|${TIME_WORDS}))?$`,
);
const readDay = (words: string) => DateTime.fromFormat(words, 'MMM d, yyyy', COPY_LOCALE);
const readTime = (day: DateTime, words: string) => {
  const time = DateTime.fromFormat(words, 'h:mm a', COPY_LOCALE);
  return time.isValid ? day.set({ hour: time.hour, minute: time.minute }) : null;
};

/**
 * Notion Calendar's line read back — ours, or one copied there: the event
 * it names, or null for any other words. An end with no day before its
 * start is the next day's ("… at 10:00 PM - 1:00 AM"); none at all, the
 * default hour.
 */
export function parseEventClipboardLine(text: string): CopiedEvent | null {
  // Intl may space a time with a narrow no-break space.
  const match = LINE.exec(text.trim().replace(/[\s\u202f]+/g, ' '));
  if (!match) return null;
  const [, title, startDay, startTime, endDay, endTime, sameDayEnd] = match;
  const day = readDay(startDay);
  const lastDay = endDay ? readDay(endDay) : day;
  if (!day.isValid || !lastDay.isValid || (startTime && endDay && !endTime)) return null;
  if (!startTime) {
    if (sameDayEnd || endTime || lastDay < day) return null;
    const end = lastDay.plus({ days: 1 });
    return { title, start: isoMoment(day), end: isoMoment(end), allDay: true };
  }
  const start = readTime(day, startTime);
  let end = endTime || sameDayEnd ? readTime(lastDay, endTime ?? sameDayEnd) : null;
  if (!start || ((endTime || sameDayEnd) && !end)) return null;
  end ??= start.plus({ minutes: DEFAULT_EVENT_MINUTES });
  if (end <= start && !endDay) end = end.plus({ days: 1 });
  if (end < start) return null;
  return { title, start: isoMoment(start), end: isoMoment(end), allDay: false };
}

/** The calendar's formats in the app's language, following a switch. */
@Service()
export class CalendarFormat {
  readonly #language = inject(I18n).lang;

  readonly formats = computed(() => calendarFormats(this.#language()));
}
