import { InjectionToken, Service, inject } from '@angular/core';
import { DateTime } from 'luxon';

import { IsoDay, isoMoment, parseDay } from './calendar-dates';
import { CalendarEvent, EventColor } from './calendar-event';

/** A public holiday: its day, its name in English and in the country's own
    language — and, for a regional one, the regions that keep it (ISO 3166-2,
    `DE-BB`); none for a nationwide one. */
export interface Holiday {
  date: IsoDay;
  name: string;
  localName: string;
  regions: string[] | null;
}

/**
 * Where holidays come from — a connector. One year of one country's public
 * holidays a call, by ISO 3166 code (`DE`, `US`, `JP`): nationwide ones and
 * regional ones (Germany's Reformation Day), as Google's holidays calendar
 * lists them. A host swaps the
 * connector by providing `HOLIDAY_SOURCE`: Google's feeds as a build-time
 * snapshot, its own backend.
 */
export interface HolidaySource {
  holidays(year: number, country: string, signal?: AbortSignal): Promise<Holiday[]>;
}

/** Nager.Date's answer, a row a holiday (date.nager.at, API v3). */
interface NagerHoliday {
  date: string;
  localName: string;
  name: string;
  /** Nationwide — or, false, only in the `counties` listed. */
  global: boolean;
  counties: string[] | null;
}

/**
 * Nager.Date's public holidays (https://date.nager.at): a free, keyless JSON
 * API that answers a browser (CORS), a few KB a country and year. Each
 * country-year is fetched once and kept for the page's life — and a failed
 * one is not kept, so the next look asks again.
 */
@Service()
export class NagerHolidays implements HolidaySource {
  readonly #years = new Map<string, Promise<Holiday[]>>();

  holidays(year: number, country: string, signal?: AbortSignal): Promise<Holiday[]> {
    const key = `${year}/${country.toUpperCase()}`;
    let rows = this.#years.get(key);
    if (!rows) {
      rows = this.#fetch(key);
      this.#years.set(key, rows);
      rows.catch(() => this.#years.delete(key));
    }
    // The fetch is shared by every caller: a caller that gives up stops
    // waiting, the fetch goes on for the next one.
    return signal ? abortable(rows, signal) : rows;
  }

  async #fetch(key: string): Promise<Holiday[]> {
    const response = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${key}`);
    if (!response.ok) throw new Error(`Nager.Date ${key}: ${response.status}`);
    const rows = (await response.json()) as NagerHoliday[];
    return rows
      .filter((row) => !!parseDay(row.date))
      .map(({ date, name, localName, global, counties }) => ({
        date,
        name,
        localName,
        regions: global ? null : (counties ?? []),
      }));
  }
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    promise.then(resolve, reject);
  });
}

/** The holidays' connector: Nager.Date unless a host provides another. */
export const HOLIDAY_SOURCE = new InjectionToken<HolidaySource>('HOLIDAY_SOURCE', {
  providedIn: 'root',
  factory: () => inject(NagerHolidays),
});

/** Holidays' colour on the calendar — Google's holidays calendar's green. */
export const HOLIDAY_COLOR: EventColor = 'sage';

/** The country whose holidays show: the browser's region (`de-DE` → DE),
    else the app language's own (English → US). */
export function holidayCountry(browserLanguage: string, appLanguage: string): string {
  try {
    const region = new Intl.Locale(browserLanguage).maximize().region;
    if (region) return region;
  } catch {
    // An unreadable tag: the app's language decides.
  }
  return ({ de: 'DE', ja: 'JP' } as Record<string, string>)[appLanguage] ?? 'US';
}

/**
 * Holidays as the calendar's events: all day, read-only (a subscribed
 * calendar's — opened, never moved or deleted), named in English for an
 * English calendar and in the country's own language otherwise. A regional
 * one says where it is kept on its card: `regional` words it, from the
 * regions' short codes (`BB, HB, HH`).
 */
export function holidayEvents(
  holidays: readonly Holiday[],
  language: string,
  regional: (regions: string) => string = (regions) => regions,
): CalendarEvent[] {
  return holidays.map((holiday) => {
    const day = DateTime.fromISO(holiday.date);
    return {
      id: `holiday:${holiday.date}:${holiday.name}`,
      title: language === 'en' ? holiday.name : holiday.localName,
      start: isoMoment(day),
      end: isoMoment(day.plus({ days: 1 })),
      allDay: true,
      color: HOLIDAY_COLOR,
      location: '',
      description: holiday.regions
        ? regional(holiday.regions.map((region) => region.replace(/^[A-Z]+-/, '')).join(', '))
        : '',
      readonly: true,
    };
  });
}
