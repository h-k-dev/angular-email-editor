import { Service, computed, inject } from '@angular/core';
import { DateTime, DateTimeFormatOptions, Interval } from 'luxon';

import { I18n } from '../translations/i18n';
import { WeekStart, weekStartOf } from './calendar-dates';
import { CalendarEvent, eventSpan } from './calendar-event';

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
  /** When an event is, in a line: "Thursday, October 29 · 10:00 – 11:00 AM",
      "Thursday, October 29" all day, "October 29 – 31" over days. */
  when(event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>): string;
}

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

/** A language's formats — pure: the view's language in, its words out.
    Luxon writes them through `Intl`, a range through its `formatRange`. */
export function calendarFormats(language: string): CalendarFormats {
  const locale = { locale: language };
  const one = (date: DateTime, options: DateTimeFormatOptions) =>
    date.toLocaleString(options, locale);
  const range = (from: DateTime, to: DateTime, options: DateTimeFormatOptions) =>
    Interval.fromDateTimes(from, to).toLocaleString(options, locale);
  const timeRange = (start: DateTime, end: DateTime) => range(start, end, HOUR_MINUTE);

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
  };
}

/** The calendar's formats in the app's language, following a switch. */
@Service()
export class CalendarFormat {
  readonly #language = inject(I18n).lang;

  readonly formats = computed(() => calendarFormats(this.#language()));
}
