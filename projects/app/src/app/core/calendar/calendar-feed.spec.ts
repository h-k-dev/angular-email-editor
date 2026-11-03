import { TestBed } from '@angular/core/testing';

import { DateTime } from 'luxon';

import { draftAt } from './calendar-event';
import { CALENDAR_FEED_LATENCY, CalendarFeed } from './calendar-feed';
import { CalendarEvents } from './calendar-events';

describe('CalendarFeed', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [{ provide: CALENDAR_FEED_LATENCY, useValue: 300 }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  const make = (title: string, at: DateTime) =>
    TestBed.inject(CalendarEvents).create({ ...draftAt(at), title });

  it('hands over a week only once it came — a little later, as a backend', () => {
    const feed = TestBed.inject(CalendarFeed);
    make('Thursday', DateTime.local(2026, 10, 29, 9));
    make('Far off', DateTime.local(2026, 12, 3, 9));

    feed.request('2026-10-26', '2026-11-01');
    expect(feed.events()).toEqual([]);
    expect(feed.loading()).toBe(1);

    vi.advanceTimersByTime(500);
    expect(feed.events().map((event) => event.title)).toEqual(['Thursday']);
    expect(feed.loading()).toBe(0);
  });

  it('shows an edit in a week that came at once — the store is the backend, applied first', () => {
    const feed = TestBed.inject(CalendarFeed);
    const store = TestBed.inject(CalendarEvents);
    feed.request('2026-10-26', '2026-11-01');
    vi.advanceTimersByTime(500);

    const made = make('New', DateTime.local(2026, 10, 30, 9));
    expect(feed.events().map((event) => event.title)).toEqual(['New']);
    store.save({ ...made, title: 'Renamed' });
    expect(feed.events().map((event) => event.title)).toEqual(['Renamed']);
  });

  it('asks each week once — a week that came, or is coming, is not asked again', () => {
    const feed = TestBed.inject(CalendarFeed);
    feed.request('2026-10-26', '2026-11-08');
    expect(feed.loading()).toBe(2);
    feed.request('2026-11-02', '2026-11-15');
    expect(feed.loading()).toBe(3);
    vi.advanceTimersByTime(500);
    feed.request('2026-10-26', '2026-11-15');
    expect(feed.loading()).toBe(0);
  });

  it('keys its weeks by Monday, whatever the view’s first weekday', () => {
    const feed = TestBed.inject(CalendarFeed);
    make('Sunday', DateTime.local(2026, 11, 1, 9));
    // A Sunday-first week, 1–7 November: the backend's weeks are the one
    // ending on that Sunday and the one after.
    feed.request('2026-11-01', '2026-11-07');
    expect(feed.loading()).toBe(2);
    vi.advanceTimersByTime(500);
    expect(feed.events().map((event) => event.title)).toEqual(['Sunday']);
  });
});
