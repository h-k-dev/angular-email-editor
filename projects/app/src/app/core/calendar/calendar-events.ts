import { Service, computed, inject } from '@angular/core';

import { LocalStorage, StorageCodec } from '../storages/local-storage';
import {
  CalendarEvent,
  CalendarEventDraft,
  DEFAULT_EVENT_COLOR,
  InviteAnswer,
  isCalendarEvent,
} from './calendar-event';
import type { Invite } from './invite';

/** What an invitation says of its event: when, what, where — and which
    version of it, by the organizer's count. */
const fromInvite = (invite: Invite) => ({
  title: invite.title,
  start: invite.start,
  end: invite.end,
  allDay: invite.allDay,
  location: invite.location || invite.conference || '',
  description: invite.description,
  uid: invite.uid,
  sequence: invite.sequence,
});

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

  /** Every event, in the order they were made — but invitations you said
      No to, which are kept for their answer, off the calendar. */
  readonly events = computed(() => this.#stored().filter((event) => event.response !== 'declined'));

  /** Each event by its id. */
  readonly byId = computed(() => new Map(this.events().map((event) => [event.id, event])));

  /** The events invitations made, by their `UID` — those you said No to
      too: the card above the message shows what you said. */
  readonly byUid = computed(
    () =>
      new Map(this.#stored().flatMap((event) => (event.uid ? [[event.uid, event] as const] : []))),
  );

  /** Your answer to an invitation: Yes and Maybe put it in the calendar
      (or keep it there, brought up to this message), No takes it off —
      the answer kept all the same. A real client would also mail the
      organizer a `REPLY`; here the calendar is the whole of it. */
  answer(invite: Invite, response: InviteAnswer): CalendarEvent {
    const known = this.byUid().get(invite.uid);
    const event: CalendarEvent = {
      ...fromInvite(invite),
      id: known?.id ?? crypto.randomUUID(),
      color: known?.color ?? DEFAULT_EVENT_COLOR,
      response,
    };
    this.save(event);
    return event;
  }

  /** A message about an invitation already answered, come in: a newer
      version (a higher `SEQUENCE`) moves the event to it, a cancellation
      takes it off. What you said stays. Nothing for one never answered,
      or one this calendar has newer. */
  follow(invite: Invite): void {
    const known = this.byUid().get(invite.uid);
    if (!known || invite.sequence < (known.sequence ?? 0)) return;
    if (invite.cancelled) {
      this.remove(known.id);
      return;
    }
    if (invite.sequence > (known.sequence ?? 0)) this.save({ ...known, ...fromInvite(invite) });
  }

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
    const gone = this.#stored().find((one) => one.id === id) ?? null;
    if (gone) this.#stored.update((events) => events.filter((one) => one.id !== id));
    return gone;
  }
}
