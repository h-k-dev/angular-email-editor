import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DateTime } from 'luxon';

import { CalendarEvent, CalendarEventDraft } from '../../../../../core/calendar/calendar-event';
import { TimeGrid } from './time-grid';

const DAYS = [
  '2026-10-25',
  '2026-10-26',
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-10-31',
];

const COFFEE: CalendarEvent = {
  id: 'coffee',
  title: 'Coffee',
  start: '2026-10-30T10:00',
  end: '2026-10-30T11:00',
  allDay: false,
  color: 'peacock',
  location: '',
  description: '',
};

@Component({
  imports: [TimeGrid],
  template: `
    <calendar-time-grid
      [days]="days"
      [events]="events()"
      [today]="days[5]"
      [now]="now"
      [draft]="draft()"
      (change)="changed = $event"
      (create)="created.push($event.draft)"
      (dismiss)="dismissed = dismissed + 1"
    />
  `,
})
class Host {
  readonly days = DAYS;
  readonly events = signal<CalendarEvent[]>([COFFEE]);
  readonly now = DateTime.fromISO('2026-10-30T08:00');
  readonly draft = signal<CalendarEventDraft | null>(null);
  changed: CalendarEvent | null = null;
  readonly created: CalendarEventDraft[] = [];
  dismissed = 0;
}

/** The hours laid out by hand (jsdom has no layout): seven 100px days,
    48px an hour, from the top of the box. */
const HOUR = 48;
const DAY = 100;

describe('TimeGrid — stretching an event', () => {
  const start = async () => {
    Element.prototype.setPointerCapture ??= () => {};
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const columns = root.querySelector<HTMLElement>('.time-grid__columns')!;
    columns.getBoundingClientRect = () => new DOMRect(0, 0, DAY * DAYS.length, HOUR * 24);
    const pointer = (target: Element, type: string, day: number, hour: number) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: day * DAY + DAY / 2,
          clientY: hour * HOUR,
        }),
      );
    return { fixture, root, columns, pointer };
  };

  it('runs past midnight across the days, in the hours while in hand — the band once dropped', async () => {
    const { fixture, root, columns, pointer } = await start();
    const foot = root.querySelector('.time-grid__foot')!;

    pointer(foot, 'pointerdown', 5, 11);
    pointer(columns, 'pointermove', 6, 12);
    await fixture.whenStable();
    // In hand: a piece in each day it runs over, none in the band.
    expect(root.querySelectorAll('.time-grid__chip[data-event-id="coffee"]')).toHaveLength(2);
    expect(root.querySelector('.time-grid__bar[data-event-id="coffee"]')).toBeNull();

    pointer(columns, 'pointerup', 6, 12);
    await fixture.whenStable();
    const changed = fixture.componentInstance.changed!;
    expect(changed).toMatchObject({ start: '2026-10-30T10:00', end: '2026-10-31T12:00' });

    // Stored so, it runs over a midnight: the band's.
    fixture.componentInstance.events.set([changed]);
    await fixture.whenStable();
    expect(root.querySelector('.time-grid__bar[data-event-id="coffee"]')).not.toBeNull();
    expect(root.querySelectorAll('.time-grid__chip[data-event-id="coffee"]')).toHaveLength(0);
  });
});

describe('TimeGrid — making an event', () => {
  const start = async () => {
    Element.prototype.setPointerCapture ??= () => {};
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const columns = root.querySelector<HTMLElement>('.time-grid__columns')!;
    columns.getBoundingClientRect = () => new DOMRect(0, 0, DAY * DAYS.length, HOUR * 24);
    const day = root.querySelectorAll<HTMLElement>('.time-grid__day')[2];
    const pointer = (target: Element, type: string, hour: number) =>
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          clientX: 2 * DAY + DAY / 2,
          clientY: hour * HOUR,
        }),
      );
    const press = (hour: number) => {
      pointer(day, 'pointerdown', hour);
      pointer(columns, 'pointerup', hour);
    };
    return { fixture, columns, day, pointer, press };
  };

  it('makes nothing on a press alone — only closes what is open', async () => {
    const { fixture, press } = await start();
    press(9);
    expect(fixture.componentInstance.created).toEqual([]);
    expect(fixture.componentInstance.dismissed).toBe(1);
  });

  it('makes an hour from the quarter on a double press', async () => {
    const { fixture, press } = await start();
    press(9);
    press(9);
    expect(fixture.componentInstance.created).toMatchObject([
      { start: '2026-10-27T09:00', end: '2026-10-27T10:00' },
    ]);
  });

  it('makes the time marked out by a drag, let go', async () => {
    const { fixture, columns, day, pointer } = await start();
    pointer(day, 'pointerdown', 9);
    pointer(columns, 'pointermove', 11);
    pointer(columns, 'pointerup', 11);
    expect(fixture.componentInstance.created).toMatchObject([
      { start: '2026-10-27T09:00', end: '2026-10-27T11:00' },
    ]);
    expect(fixture.componentInstance.dismissed).toBe(0);
  });

  it('marks out anew from a press inside the pending mark — never picks the mark up', async () => {
    const { fixture, columns, pointer } = await start();
    fixture.componentInstance.draft.set({
      title: '',
      start: '2026-10-27T09:00',
      end: '2026-10-27T11:00',
      allDay: false,
      color: 'peacock',
      location: '',
      description: '',
    });
    await fixture.whenStable();
    const mark = (fixture.nativeElement as HTMLElement).querySelector('[data-event-id="draft"]')!;

    pointer(mark, 'pointerdown', 10);
    pointer(columns, 'pointermove', 12);
    pointer(columns, 'pointerup', 12);
    expect(fixture.componentInstance.created).toMatchObject([
      { start: '2026-10-27T10:00', end: '2026-10-27T12:00' },
    ]);
  });
});
