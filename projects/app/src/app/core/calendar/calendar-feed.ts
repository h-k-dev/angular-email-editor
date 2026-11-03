import { InjectionToken, Service, computed, inject, signal } from '@angular/core';
import { DateTime } from 'luxon';

import { CalendarEvents } from './calendar-events';
import { IsoDay, isoDay, parseDay } from './calendar-dates';
import { CalendarEvent, eventSpan } from './calendar-event';

/** How long the backend takes to answer a week, ms — a network's; a little
    more, at random (`JITTER`), so weeks come one by one. 0: at once (the
    unit tests'). */
export const CALENDAR_FEED_LATENCY = new InjectionToken<number>('CALENDAR_FEED_LATENCY', {
  providedIn: 'root',
  factory: () => 350,
});
const JITTER = 150;

/** A week's key: its Monday — the backend's weeks, whatever the view's
    first weekday. */
function weekOf(date: DateTime): IsoDay {
  return isoDay(date.startOf('day').minus({ days: date.weekday - 1 }));
}

/** Every week from `from` to `to`, by their keys. */
function weeksFrom(from: DateTime, to: DateTime): IsoDay[] {
  const weeks: IsoDay[] = [];
  for (let week = parseDay(weekOf(from))!; week <= to; week = week.plus({ weeks: 1 })) {
    weeks.push(isoDay(week));
  }
  return weeks;
}

/** The weeks an event touches. */
function weeksOfEvent(event: CalendarEvent): IsoDay[] {
  const { start, end } = eventSpan(event);
  return weeksFrom(start, DateTime.max(start, end.minus({ minutes: 1 })));
}

/**
 * The events as a backend hands them over — a week at a time, asked for as
 * the views come to them (`request`: what a grid has drawn, a strip's
 * buffer included), each week a little later (`CALENDAR_FEED_LATENCY`):
 * scrolled to somewhere new, a week's events come in after it is drawn,
 * Notion's. Asked once a week; a week that came stays.
 *
 * Simulated over `CalendarEvents`, this browser's store, which stands for
 * the backend: a week that came shows the store's events as they are now —
 * an edit there stands at once (the backend's answer applied first,
 * optimistic), only a week not yet come shows nothing.
 */
@Service()
export class CalendarFeed {
  readonly #store = inject(CalendarEvents);
  readonly #latency = inject(CALENDAR_FEED_LATENCY);

  /** The weeks that came, and those on their way. */
  readonly #loaded = signal<ReadonlySet<IsoDay>>(new Set());
  readonly #pending = new Set<IsoDay>();

  /** How many weeks are on their way. */
  readonly loading = signal(0);

  /** The events of the weeks that came. */
  readonly events = computed(() => {
    const loaded = this.#loaded();
    return this.#store
      .events()
      .filter((event) => weeksOfEvent(event).some((week) => loaded.has(week)));
  });

  /** Asks for every week from `from` to `to` not yet come or coming. */
  request(from: IsoDay, to: IsoDay): void {
    const first = parseDay(from);
    const last = parseDay(to);
    if (!first || !last) return;
    const loaded = this.#loaded();
    const asked = weeksFrom(first, last).filter(
      (week) => !loaded.has(week) && !this.#pending.has(week),
    );
    if (!asked.length) return;
    if (this.#latency <= 0) {
      this.#loaded.update((loaded) => new Set([...loaded, ...asked]));
      return;
    }
    this.loading.update((count) => count + asked.length);
    for (const week of asked) {
      this.#pending.add(week);
      setTimeout(() => this.#arrive(week), this.#latency + Math.random() * JITTER);
    }
  }

  #arrive(week: IsoDay): void {
    if (!this.#pending.delete(week)) return;
    this.loading.update((count) => count - 1);
    this.#loaded.update((loaded) => new Set([...loaded, week]));
  }
}
