import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DateTime } from 'luxon';

import { CalendarEvent } from '../../../../../core/calendar/calendar-event';
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
      (change)="changed = $event"
    />
  `,
})
class Host {
  readonly days = DAYS;
  readonly events = signal<CalendarEvent[]>([COFFEE]);
  readonly now = DateTime.fromISO('2026-10-30T08:00');
  changed: CalendarEvent | null = null;
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
