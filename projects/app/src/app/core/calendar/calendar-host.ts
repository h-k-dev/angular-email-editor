import { InjectionToken, Signal, WritableSignal } from '@angular/core';

import type { RegionCode } from './calendar-regions';

/**
 * What the calendar asks of the app it lives in — its one door out. The
 * calendar (core/calendar, the calendar partials, the mini month, the date
 * field) imports nothing of the app's: no preferences, no translations
 * service, no storage. The app answers here (`provideAppCalendarHost`), so
 * the calendar can leave for a package of its own without a rewrite.
 *
 * Signals throughout: a language switch, a region picked in the settings,
 * an event kept in another tab — the calendar follows each as it happens.
 */
export interface CalendarHost {
  /** The language the calendar writes its words, dates and times in. */
  readonly language: Signal<string>;
  /** The region whose calendar it lays out — its week, its week numbers,
      its holidays. Apart from the language: German words over a
      Japanese calendar. */
  readonly region: Signal<RegionCode>;
  /** The shortest a timed event may be, minutes — a mark on the hours, a
      stretched end, the editor's end. */
  readonly minDuration: Signal<number>;
  /** A value the calendar keeps between visits (its events) under its
      own key, as `codec` writes it: what it is is the calendar's, where
      it lives (this browser, a server) the host's. A write lands at once. */
  store<T>(key: string, codec: CalendarCodec<T>): WritableSignal<T>;
  /** One of the calendar's words by its key (`calendar.colors.sage`).
      Reactive: read in a `computed`, it follows a language switch. */
  label(key: string, params?: Record<string, unknown>): string;
}

/** How a kept value is written as a string and read back — `null` while
    unset, or written to remove it. `read` answers a default for anything
    it does not recognise: a key another version wrote never breaks the
    calendar. */
export interface CalendarCodec<T> {
  read(raw: string | null): T;
  write(value: T): string | null;
}

/** The app's answer to {@link CalendarHost} — no default: a calendar
    outside an app that provides one has nothing to stand on. */
export const CALENDAR_HOST = new InjectionToken<CalendarHost>('CALENDAR_HOST');
