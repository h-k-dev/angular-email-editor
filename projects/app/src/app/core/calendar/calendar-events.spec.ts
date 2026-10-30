import { TestBed } from '@angular/core/testing';

import { DateTime } from 'luxon';

import { draftAt } from './calendar-event';
import { CalendarEvents } from './calendar-events';
import type { Invite } from './invite';

describe('CalendarEvents', () => {
  const KEY = 'angular-email-editor:calendar-events';

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => localStorage.clear());

  it('starts empty: it makes up no event', () => {
    expect(TestBed.inject(CalendarEvents).events()).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('stores what is made, saved and removed — and keeps it for the next visit', () => {
    const store = TestBed.inject(CalendarEvents);
    const made = store.create({ ...draftAt(DateTime.local(2026, 10, 29, 9)), title: 'Review' });
    expect(made.id).toBeTruthy();
    expect(made.end).toBe('2026-10-29T10:00');

    store.save({ ...made, title: 'Design review' });
    expect(store.byId().get(made.id)?.title).toBe('Design review');
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([{ ...made, title: 'Design review' }]);

    const gone = store.remove(made.id);
    expect(gone?.title).toBe('Design review');
    expect(store.events()).toEqual([]);
    expect(store.remove(made.id)).toBeNull();

    // Undo: stored again.
    store.save(gone!);
    expect(store.events()).toEqual([gone]);
  });

  it('drops a stored row it cannot read, never the calendar', () => {
    const good = { ...draftAt(DateTime.local(2026, 10, 29, 9)), id: 'a' };
    localStorage.setItem(KEY, JSON.stringify([good, { id: 'b', title: 4 }, null]));
    expect(TestBed.inject(CalendarEvents).events()).toEqual([good]);

    localStorage.setItem(KEY, '{not json');
    TestBed.resetTestingModule();
    expect(TestBed.inject(CalendarEvents).events()).toEqual([]);
  });
  describe('invitations', () => {
    const INVITE: Invite = {
      uid: 'abc@google.com',
      sequence: 0,
      method: 'REQUEST',
      cancelled: false,
      title: 'Accounting',
      start: '2026-10-28T10:00',
      end: '2026-10-28T10:30',
      allDay: false,
      recurring: false,
      location: '',
      description: 'Notes',
      conference: 'https://meet.google.com/abc',
      organizer: null,
      attendees: [],
    };

    it('Yes puts it in the calendar, by its UID — where to join as its place', () => {
      const store = TestBed.inject(CalendarEvents);
      const event = store.answer(INVITE, 'accepted');
      expect(store.events()).toEqual([event]);
      expect(event).toMatchObject({
        title: 'Accounting',
        uid: 'abc@google.com',
        response: 'accepted',
        location: 'https://meet.google.com/abc',
      });
      expect(store.byUid().get('abc@google.com')).toEqual(event);
    });

    it('No takes it off the calendar, the answer kept — and a change of mind brings it back as it was', () => {
      const store = TestBed.inject(CalendarEvents);
      const yes = store.answer(INVITE, 'accepted');
      store.save({ ...yes, color: 'grape' });
      store.answer(INVITE, 'declined');
      expect(store.events()).toEqual([]);
      expect(store.byUid().get(INVITE.uid)?.response).toBe('declined');
      const maybe = store.answer(INVITE, 'tentative');
      expect(maybe.id).toBe(yes.id);
      expect(maybe.color).toBe('grape');
      expect(store.events()).toHaveLength(1);
    });

    it('follows a newer version of one answered, keeping the answer; a cancellation takes it off', () => {
      const store = TestBed.inject(CalendarEvents);
      store.answer(INVITE, 'tentative');
      store.follow({ ...INVITE, sequence: 1, start: '2026-10-28T11:00', end: '2026-10-28T11:30' });
      expect(store.events()[0]).toMatchObject({
        start: '2026-10-28T11:00',
        sequence: 1,
        response: 'tentative',
      });
      // An older message changes nothing.
      store.follow(INVITE);
      expect(store.events()[0].start).toBe('2026-10-28T11:00');
      store.follow({ ...INVITE, sequence: 2, cancelled: true });
      expect(store.byUid().size).toBe(0);
    });

    it('leaves one never answered to the card', () => {
      const store = TestBed.inject(CalendarEvents);
      store.follow({ ...INVITE, sequence: 3 });
      expect(store.events()).toEqual([]);
    });
  });
});
