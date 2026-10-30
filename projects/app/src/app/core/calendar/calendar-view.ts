import { DateTime } from 'luxon';

import { IsoDay, WeekStart, dayRange, isoDay, monthWeeks, startOfWeek } from './calendar-dates';
import { CalendarView, isCustomView, viewSegment } from './calendar-view-token';

export {
  CUSTOM_VIEW,
  DEFAULT_CUSTOM_VIEW,
  FIXED_VIEWS,
  isCalendarView,
  isCustomView,
} from './calendar-view-token';
export type { CalendarView, CustomView, FixedView } from './calendar-view-token';

/** How many days Schedule lists from its day. */
export const SCHEDULE_DAYS = 28;

/** How a view lays its days out. */
export type CalendarLayout = 'hours' | 'weeks' | 'year' | 'schedule';

/** What a view shows for a day. */
export interface CalendarPage {
  view: CalendarView;
  layout: CalendarLayout;
  /** Unique per view and range: two days of one week are one page. */
  key: string;
  /** hours: the days in the hours. schedule: the days listed. */
  days: IsoDay[];
  /** weeks: the rows of days. */
  weeks: IsoDay[][];
  /** year: each month's first day. */
  months: IsoDay[];
  /** weeks: the month whose days are not faint — none for a run of weeks. */
  month: IsoDay | null;
  from: DateTime;
  to: DateTime;
}

/** Whether a day is a Saturday or a Sunday. */
const weekend = (day: IsoDay): boolean => DateTime.fromISO(day).weekday > 5;

/**
 * What `view` shows for `date`. Without weekends, the days in the hours and
 * the weeks' rows leave Saturday and Sunday out — a day view keeps its one
 * day, whatever it is.
 */
export function calendarPage(
  view: CalendarView,
  date: DateTime,
  weekStart: WeekStart,
  { weekends = true }: { weekends?: boolean } = {},
): CalendarPage {
  const day = date.startOf('day');
  const keep = (days: IsoDay[]) => (weekends ? days : days.filter((one) => !weekend(one)));
  const base = {
    view,
    days: [] as IsoDay[],
    weeks: [] as IsoDay[][],
    months: [] as IsoDay[],
    month: null as IsoDay | null,
  };
  const key = (from: DateTime) => `${view}:${isoDay(from)}:${weekends ? 7 : 5}`;

  if (view === 'year') {
    const from = day.startOf('year');
    return {
      ...base,
      layout: 'year',
      key: key(from),
      months: Array.from({ length: 12 }, (_, i) => isoDay(from.plus({ months: i }))),
      from,
      to: day.endOf('year').startOf('day'),
    };
  }
  if (view === 'schedule') {
    return {
      ...base,
      layout: 'schedule',
      key: key(day),
      days: dayRange(day, SCHEDULE_DAYS),
      from: day,
      to: day.plus({ days: SCHEDULE_DAYS - 1 }),
    };
  }
  if (view === 'month' || (isCustomView(view) && view.endsWith('w'))) {
    const weeks =
      view === 'month'
        ? monthWeeks(day, weekStart)
        : Array.from({ length: parseInt(view, 10) }, (_, i) =>
            dayRange(startOfWeek(day, weekStart).plus({ weeks: i }), 7),
          );
    const from = view === 'month' ? day.startOf('month') : DateTime.fromISO(weeks[0][0]);
    return {
      ...base,
      layout: 'weeks',
      key: key(from),
      weeks: weeks.map(keep),
      month: view === 'month' ? isoDay(day) : null,
      from,
      to: view === 'month' ? day.endOf('month').startOf('day') : DateTime.fromISO(weeks.at(-1)![6]),
    };
  }
  const count = view === 'day' ? 1 : view === 'week' ? 7 : parseInt(view, 10);
  const from = view === 'week' ? startOfWeek(day, weekStart) : day;
  const days = dayRange(from, count);
  return {
    ...base,
    layout: 'hours',
    key: key(from),
    days: view === 'day' ? days : keep(days),
    from,
    to: from.plus({ days: count - 1 }),
  };
}

/** The day a view's previous (-1) or next (1) page shows, from `date`: as
    far as the view reaches — a custom one by its own length. */
export function stepped(view: CalendarView, date: DateTime, direction: -1 | 1): DateTime {
  if (isCustomView(view)) {
    const count = parseInt(view, 10);
    return view.endsWith('d')
      ? date.plus({ days: count * direction })
      : date.plus({ weeks: count * direction });
  }
  if (view === 'schedule') return date.plus({ days: SCHEDULE_DAYS * direction });
  return date.plus({ [`${view}s`]: direction });
}

/**
 * A view's place, Google Calendar's path: `/calendar/r/day/2027/1/26` —
 * numbers without padding, read straight back into a date (no format to
 * parse); the year view's is the year alone, `/calendar/r/year/2027`.
 */
export function calendarPath(view: CalendarView, day: IsoDay | DateTime): string {
  const date = typeof day === 'string' ? DateTime.fromISO(day) : day;
  const segment = viewSegment(view);
  return segment === 'year'
    ? `/calendar/r/year/${date.year}`
    : `/calendar/r/${segment}/${date.year}/${date.month}/${date.day}`;
}

/**
 * The view a drag across the mini month asks for, Google's: a single day
 * is the day; days within one week are as many days (a whole week, the
 * week); across weeks, as many whole weeks — up to six.
 */
export function rangeView(
  a: IsoDay,
  b: IsoDay,
  weekStart: WeekStart,
): { view: CalendarView; date: DateTime } {
  const [from, to] = [a, b].sort().map((day) => DateTime.fromISO(day));
  const days = Math.round(to.diff(from, 'days').days) + 1;
  if (days === 1) return { view: 'day', date: from };
  const first = startOfWeek(from, weekStart);
  const last = startOfWeek(to, weekStart);
  if (+first === +last) {
    return days === 7 ? { view: 'week', date: from } : { view: `${days}d`, date: from };
  }
  const weeks = Math.min(6, Math.round(last.diff(first, 'weeks').weeks) + 1);
  return { view: `${weeks}w`, date: first };
}
