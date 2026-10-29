import { DateTime } from 'luxon';

import { DAY_MINUTES, IsoDay, daysBetween, minuteOfDay, parseDay } from './calendar-dates';
import { CalendarEvent, eventSpan, inBand } from './calendar-event';

/**
 * Where events go on a calendar's grid — numbers only, never pixels: a
 * view multiplies them by its own sizes. Two layouts, Google's:
 *
 * - **A day's hours** (`placeInDay`): each timed event a block from its
 *   start minute, as long as it lasts; events that overlap share the
 *   width, side by side in columns, as few as the overlap needs.
 * - **A run of days** (`placeInLanes`): each event a bar across the days
 *   it covers, on the first lane down where it fits — the band over a
 *   week's hours, and every row of a month.
 */

/** A timed event in a day's hours. */
export interface DayPlacement {
  event: CalendarEvent;
  /** Minutes from the day's midnight to where it shows from. */
  top: number;
  /** Minutes it shows for — at least `minLength`. */
  length: number;
  /** Its column, and how many its overlap shares the width between. */
  column: number;
  columns: number;
  /** Whether it began the day before, or ends the day after (cut). */
  cutStart: boolean;
  cutEnd: boolean;
}

/**
 * The timed events of `day`, placed. `minLength` is the shortest an event
 * shows for (a 5-minute event still needs room for its title) — and counts
 * for overlap too, as Google's does: two that only look stacked share.
 */
export function placeInDay(
  events: readonly CalendarEvent[],
  day: IsoDay,
  minLength = 20,
): DayPlacement[] {
  const midnight = parseDay(day);
  if (!midnight) return [];
  const next = midnight.plus({ days: 1 });

  const placed = events
    .filter((event) => !inBand(event))
    .map((event) => ({ event, ...eventSpan(event) }))
    .filter(({ start, end }) => start < next && (end > midnight || +start === +end))
    .map(({ event, start, end }) => {
      const top = start < midnight ? 0 : minuteOfDay(start);
      const bottom = end >= next ? DAY_MINUTES : minuteOfDay(end);
      return {
        event,
        top,
        length: Math.max(bottom - top, minLength),
        column: 0,
        columns: 1,
        cutStart: start < midnight,
        cutEnd: end > next,
      };
    })
    // Earliest first; of two at once, the longer first — it takes the
    // first column, as Google's does.
    .sort((a, b) => a.top - b.top || b.length - a.length || a.event.id.localeCompare(b.event.id));

  // Clusters: runs of events each overlapping the run so far. Within one,
  // an event takes the first column free by its start.
  let cluster: DayPlacement[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];
  const close = () => {
    const columns = columnEnds.length;
    for (const one of cluster) one.columns = columns;
    cluster = [];
    columnEnds = [];
  };
  for (const one of placed) {
    if (one.top >= clusterEnd) close();
    let column = columnEnds.findIndex((end) => end <= one.top);
    if (column < 0) column = columnEnds.push(0) - 1;
    columnEnds[column] = one.top + one.length;
    one.column = column;
    cluster.push(one);
    clusterEnd = Math.max(clusterEnd, one.top + one.length);
  }
  close();
  return placed;
}

/** An event on a run of days. */
export interface LanePlacement {
  event: CalendarEvent;
  /** The day it shows from (0 = the run's first) and how many it covers. */
  from: number;
  span: number;
  /** Its lane, top down. */
  lane: number;
  /** Whether it began before the run, or goes on after it. */
  before: boolean;
  after: boolean;
}

/**
 * The events on `days`, placed in lanes. `only: 'band'` keeps the band's
 * (all-day and across midnight) — a week's band over its hours; `'all'` keeps
 * every one, a timed event on its one day — a month's row. Bars first, the
 * longest first, then the day's timed events by their time: the order
 * Google lists a month's day in.
 */
export function placeInLanes(
  events: readonly CalendarEvent[],
  days: readonly IsoDay[],
  only: 'band' | 'all' = 'band',
): LanePlacement[] {
  const first = parseDay(days[0]);
  if (!first) return [];
  const count = days.length;

  const placed = events
    .filter((event) => only === 'all' || inBand(event))
    .map((event) => {
      const { start, end } = eventSpan(event);
      // The last day it holds: its exclusive end's minute before.
      const last = DateTime.max(start, end.minus({ minutes: 1 }));
      const from = daysBetween(first, start);
      const to = daysBetween(first, last);
      return { event, from, to, band: inBand(event), start };
    })
    .filter(({ from, to }) => to >= 0 && from < count)
    .map(({ event, from, to, band, start }) => {
      const shownFrom = Math.max(from, 0);
      const shownTo = Math.min(to, count - 1);
      return {
        placement: {
          event,
          from: shownFrom,
          span: shownTo - shownFrom + 1,
          lane: 0,
          before: from < 0,
          after: to > count - 1,
        } satisfies LanePlacement,
        band,
        start: +start,
      };
    })
    .sort(
      (a, b) =>
        a.placement.from - b.placement.from ||
        Number(b.band) - Number(a.band) ||
        b.placement.span - a.placement.span ||
        a.start - b.start ||
        a.placement.event.id.localeCompare(b.placement.event.id),
    )
    .map(({ placement }) => placement);

  // Each lane's next free day.
  const free: number[] = [];
  for (const one of placed) {
    let lane = free.findIndex((day) => day <= one.from);
    if (lane < 0) lane = free.push(0) - 1;
    free[lane] = one.from + one.span;
    one.lane = lane;
  }
  return placed;
}

/** How many lanes `placements` take. */
export function laneCount(placements: readonly LanePlacement[]): number {
  return placements.reduce((most, one) => Math.max(most, one.lane + 1), 0);
}
