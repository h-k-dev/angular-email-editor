import { TestBed } from '@angular/core/testing';

import { DateTime } from 'luxon';

import { draftAt } from './calendar-event';
import { CalendarEvents } from './calendar-events';

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
});
