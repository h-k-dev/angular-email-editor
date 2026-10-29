import { Service, computed, inject } from '@angular/core';

import { LocalStorage, StorageCodec } from '../storages/local-storage';
import { CalendarEvent, CalendarEventDraft, isCalendarEvent } from './calendar-event';

/** The events as storage keeps them: a JSON array, nothing while empty. A
    row this version does not read is dropped, never a broken calendar. */
const eventList: StorageCodec<readonly CalendarEvent[]> = {
  read: (raw) => {
    if (!raw) return [];
    try {
      const rows: unknown = JSON.parse(raw);
      return Array.isArray(rows) ? rows.filter(isCalendarEvent) : [];
    } catch {
      return [];
    }
  },
  write: (events) => (events.length ? JSON.stringify(events) : null),
};

/**
 * The calendar's events: the ones you made, kept in this browser — every
 * tab sees them, a reload keeps them. No demo set: the example catalogue
 * holds no event (its one appointment says `Date: DD-MM-YYYY`), and the
 * calendar makes up none.
 *
 * Signals, not the snippet store's requests: a dropped event must stand
 * where it was dropped at once, not after a round trip. A host with a
 * backend keeps this shape over `/api/events` — `events` its last
 * answer, the writes its `POST` / `PATCH` / `DELETE`, applied here
 * first (optimistic).
 */
@Service()
export class CalendarEvents {
  readonly #stored = inject(LocalStorage).pairSignal(
    'angular-email-editor:calendar-events',
    eventList,
  );

  /** Every event, in the order they were made. */
  readonly events = this.#stored.asReadonly();

  /** Each event by its id. */
  readonly byId = computed(() => new Map(this.events().map((event) => [event.id, event])));

  /** Stores a new event and answers it with its id — one that survives the
      reload the event does. */
  create(draft: CalendarEventDraft): CalendarEvent {
    const event: CalendarEvent = { ...draft, id: crypto.randomUUID() };
    this.#stored.update((events) => [...events, event]);
    return event;
  }

  /** Stores `event` over the one with its id; an event no longer there is
      stored again (an undone delete). */
  save(event: CalendarEvent): void {
    this.#stored.update((events) =>
      events.some((one) => one.id === event.id)
        ? events.map((one) => (one.id === event.id ? event : one))
        : [...events, event],
    );
  }

  /** Deletes the event with this id and answers it, for an undo — or null,
      where it was gone already. */
  remove(id: string): CalendarEvent | null {
    const gone = this.byId().get(id) ?? null;
    if (gone) this.#stored.update((events) => events.filter((one) => one.id !== id));
    return gone;
  }
}
