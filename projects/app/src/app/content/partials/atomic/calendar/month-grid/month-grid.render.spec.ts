/**
 * The month's strip in real Chromium — `npm run test:render` (jsdom has no
 * layout, no scrolling and no frames): weeks laid out by their index,
 * where the page stands; a drag past the weeks' top or at their foot
 * scrolls the strip a month at a time, what it marks or carries running
 * on with it — the day under the pointer always the strip's arithmetic.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { DateTime } from 'luxon';

import { IsoDay, isoDay, monthWeeks } from '../../../../../core/calendar/calendar-dates';
import { CalendarEvent, CalendarEventDraft } from '../../../../../core/calendar/calendar-event';
import { MonthGrid } from './month-grid';

const LUNCH: CalendarEvent = {
  id: 'lunch',
  title: 'Lunch',
  start: '2026-10-14T13:00',
  end: '2026-10-14T14:00',
  allDay: false,
  color: 'peacock',
  location: '',
  description: '',
};

const TRIP: CalendarEvent = {
  id: 'trip',
  title: 'Trip',
  start: '2026-09-29T00:00',
  end: '2026-10-01T00:00',
  allDay: true,
  color: 'tomato',
  location: '',
  description: '',
};

@Component({
  imports: [MonthGrid],
  template: `
    <div style="display: flex; flex-direction: column; inline-size: 700px; block-size: 600px">
      <calendar-month-grid
        style="flex: 1; min-block-size: 0"
        [weeks]="weeks()"
        [month]="month()"
        [events]="events"
        [today]="month()"
        (create)="created.push($event.draft)"
        (change)="changed.push($event)"
        (rangeChange)="follow($event)"
      />
    </div>
  `,
})
class Host {
  /** The page's month: a day of it, as the path has it. */
  readonly day = signal(DateTime.fromISO('2026-10-14'));
  readonly month = () => isoDay(this.day());
  readonly weeks = () => monthWeeks(this.day(), 7);
  readonly events = [LUNCH, TRIP];
  readonly created: CalendarEventDraft[] = [];
  readonly changed: CalendarEvent[] = [];
  /** Where the strip scrolled to, and when. */
  readonly ranges: { day: IsoDay; at: number }[] = [];

  /** The page's follow: its path goes where the strip went. */
  follow(day: IsoDay): void {
    this.ranges.push({ day, at: performance.now() });
    this.day.set(DateTime.fromISO(day));
  }
}

describe('MonthGrid (render) — the strip', () => {
  let fixture: ComponentFixture<Host>;

  const host = () => fixture.componentInstance;
  const root = () => fixture.nativeElement as HTMLElement;
  const grid = () => root().querySelector<HTMLElement>('calendar-month-grid')!;
  const scroller = () => root().querySelector<HTMLElement>('.month-grid__weeks')!;
  const cell = (day: IsoDay) =>
    root().querySelector<HTMLElement>(`.month-grid__cell[data-day="${day}"]`)!;
  const box = () => scroller().getBoundingClientRect();
  /** The drawn rows' days, top down, as on screen. */
  const drawn = () =>
    [...root().querySelectorAll<HTMLElement>('.month-grid__week')]
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .map((row) =>
        [...row.querySelectorAll<HTMLElement>('.month-grid__cell')].map(
          (one) => one.dataset['day']!,
        ),
      );
  /** The first day of the row at the strip's top. */
  const topDay = () => {
    const top = box().top;
    const row = [...root().querySelectorAll<HTMLElement>('.month-grid__week')].find(
      (one) => Math.abs(one.getBoundingClientRect().top - top) < 2,
    );
    return row?.querySelector<HTMLElement>('.month-grid__cell')?.dataset['day'];
  };
  const marked = () =>
    drawn()
      .flat()
      .filter((day) => cell(day).classList.contains('month-grid__cell--marked'));
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const pointer = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: type === 'pointermove' ? -1 : 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    );

  const settle = async (ms: number) => {
    await wait(ms);
    await fixture.whenStable();
    await frame();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    await settle(100);
    // A synthetic pointer is no live one to capture.
    grid().setPointerCapture = () => {};
  });

  afterEach(() => fixture.nativeElement.remove());

  it('stands where the page is: the month’s first week at the top, only the rows about it drawn', () => {
    expect(topDay()).toBe('2026-09-27');
    expect(drawn().length).toBeLessThan(14);
    expect(host().ranges).toEqual([]);
  });

  it('follows the page straight there — and the page the strip, scrolled', async () => {
    host().day.set(DateTime.fromISO('2026-12-03'));
    await settle(100);
    expect(topDay()).toBe('2026-11-29');
    expect(host().ranges).toEqual([]);

    scroller().scrollBy({ top: scroller().clientHeight * 0.9 });
    await settle(600);
    // The wheel stops at the next month's first week; the page follows.
    expect(topDay()).toBe('2026-12-27');
    expect(host().ranges.map(({ day }) => day)).toEqual(['2027-01-01']);
  });

  it('marks whole days, Notion’s — washed cells, no bar', async () => {
    const start = cell('2026-10-14').getBoundingClientRect();
    const x = start.left + start.width / 2;
    pointer(cell('2026-10-14'), 'pointerdown', x, start.bottom - 10);
    pointer(grid(), 'pointermove', x, start.top - 40);
    await settle(50);
    expect(marked()).toEqual([
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
    expect(root().querySelector('[data-event-id="draft"]')).toBeNull();
    const wash = getComputedStyle(cell('2026-10-14'), '::after');
    expect([wash.opacity, wash.position, wash.inset]).toEqual(['0.125', 'absolute', '0px']);
    pointer(grid(), 'pointerup', x, start.top - 40);
  });

  it('scrolls to the next month as a mark reaches the weeks’ foot — it runs on into it', async () => {
    const start = cell('2026-10-14').getBoundingClientRect();
    const x = start.left + start.width / 2;
    pointer(cell('2026-10-14'), 'pointerdown', x, start.bottom - 10);
    pointer(grid(), 'pointermove', x, start.bottom + 40);
    pointer(grid(), 'pointermove', x, box().bottom + 10);
    await settle(700);
    pointer(grid(), 'pointerup', x, box().bottom + 10);

    expect(host().ranges.map(({ day }) => day)).toEqual(['2026-11-01']);
    expect(topDay()).toBe('2026-11-01');
    const [draft] = host().created;
    // From the Wednesday pressed to the last row in view, under the pointer.
    expect([draft.start, draft.end]).toEqual(['2026-10-14T00:00', '2026-12-10T00:00']);
  });

  it('moves an event into the month before, carried past the weeks’ top', async () => {
    const chip = root().querySelector<HTMLElement>('[data-event-id="lunch"]')!;
    const at = chip.getBoundingClientRect();
    const x = at.left + 20;
    pointer(chip, 'pointerdown', x, at.top + 5);
    pointer(grid(), 'pointermove', x, at.top - 60);
    pointer(grid(), 'pointermove', x, box().top - 10);
    await settle(700);
    pointer(grid(), 'pointerup', x, box().top - 10);

    expect(host().ranges.map(({ day }) => day)).toEqual(['2026-09-01']);
    const [moved] = host().changed;
    // To September's first row, the same weekday, its time kept.
    expect([moved.start, moved.end]).toEqual(['2026-09-02T13:00', '2026-09-02T14:00']);
  });

  it('a month each 820ms for a hand wavering across the top — the wash never broken or lost', async () => {
    const start = cell('2026-10-14').getBoundingClientRect();
    const x = start.left + start.width / 2;
    const top = box().top;
    const problems: string[] = [];
    let watching = true;
    const watch = () => {
      if (!watching) return;
      const days = drawn().flat();
      const washed = marked();
      // The room runs from the top's first rows down to 14 October: every
      // drawn day between its first washed day and 14 October is washed.
      const first = days.indexOf(washed[0]);
      const last = days.filter((day) => day <= '2026-10-14').length - 1;
      if (!washed.length) problems.push('none washed');
      else if (washed.length !== last - first + 1) problems.push(`gaps from ${washed[0]}`);
      requestAnimationFrame(watch);
    };
    pointer(cell('2026-10-14'), 'pointerdown', x, start.bottom - 10);
    pointer(grid(), 'pointermove', x, start.top - 40);
    requestAnimationFrame(watch);
    for (let i = 0; i < 70; i++) {
      // Over the edge, and back under it by a pixel or two, now and then.
      pointer(grid(), 'pointermove', x, top - 3 + (i % 4 === 0 ? 5 : 0) - (i % 3));
      await wait(30);
    }
    watching = false;
    pointer(grid(), 'pointerup', x, top - 3);

    // 2.1s held: September at once, August at 820ms, July at 1640ms.
    expect(host().ranges.map(({ day }) => day)).toEqual(['2026-09-01', '2026-08-01', '2026-07-01']);
    const times = host().ranges.map(({ at }) => at);
    expect(times.slice(1).every((at, i) => at - times[i] >= 700)).toBe(true);
    expect(problems).toEqual([]);
  });

  it('turns nothing for a bar carried along the first week, right under its top', async () => {
    const chip = root().querySelector<HTMLElement>('[data-event-id="trip"]')!;
    const at = chip.getBoundingClientRect();
    const y = at.top + at.height / 2;
    pointer(chip, 'pointerdown', at.left + 10, y);
    pointer(grid(), 'pointermove', at.left + 120, y);
    await settle(1000);
    pointer(grid(), 'pointerup', at.left + 120, y);
    expect(host().ranges).toEqual([]);
    expect(host().changed.length).toBe(1);
  });
});
