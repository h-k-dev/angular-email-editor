import { DateTime } from 'luxon';

import { IsoDay, WeekStart, dayRange, isoDay, monthWeeks, startOfWeek } from './calendar-dates';

/** The ways a calendar shows its days, Google's: one day's hours, a week's,
    or the month's weeks. */
export const CALENDAR_VIEWS = ['day', 'week', 'month'] as const;

export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export function isCalendarView(value: unknown): value is CalendarView {
  return CALENDAR_VIEWS.includes(value as CalendarView);
}

/** What a view shows for a day: the days in its hours (a day, a week), or
    the weeks of its month — and the first and last of them. */
export interface CalendarPage {
  view: CalendarView;
  /** Unique per view and range: two days of one week are one page. */
  key: string;
  /** The day or week view's days. */
  days: IsoDay[];
  /** The month view's weeks. */
  weeks: IsoDay[][];
  from: DateTime;
  to: DateTime;
}

export function calendarPage(
  view: CalendarView,
  date: DateTime,
  weekStart: WeekStart,
): CalendarPage {
  if (view === 'month') {
    const weeks = monthWeeks(date, weekStart);
    return {
      view,
      key: `month:${date.toFormat('yyyy-MM')}`,
      days: [],
      weeks,
      from: date.startOf('month'),
      to: date.endOf('month').startOf('day'),
    };
  }
  const from = view === 'week' ? startOfWeek(date, weekStart) : date.startOf('day');
  const days = dayRange(from, view === 'week' ? 7 : 1);
  return {
    view,
    key: `${view}:${days[0]}`,
    days,
    weeks: [],
    from,
    to: from.plus({ days: days.length - 1 }),
  };
}

/** The day a view's previous (-1) or next (1) page shows, from `date`. */
export function stepped(view: CalendarView, date: DateTime, direction: -1 | 1): DateTime {
  return date.plus({ [`${view}s`]: direction });
}

/** A view's place: `/calendar/week/2026-10-29`. */
export function calendarPath(view: CalendarView, day: IsoDay | DateTime): string {
  return `/calendar/${view}/${typeof day === 'string' ? day : isoDay(day)}`;
}
