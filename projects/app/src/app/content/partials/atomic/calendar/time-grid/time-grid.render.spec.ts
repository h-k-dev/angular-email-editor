/**
 * The hours' strip in real Chromium — `npm run test:render` (jsdom has no
 * layout, no scrolling and no frames): days laid out by their index, where
 * the page stands; a drag held at the hours' foot or top scrolls them on,
 * at the days' start or end it slides the strip a week — at once, and on
 * while held there. What it marks or moves runs on with them.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { DateTime } from 'luxon';

import { IsoDay, isoDay, startOfWeek } from '../../../../../core/calendar/calendar-dates';
import { CalendarEvent, CalendarEventDraft } from '../../../../../core/calendar/calendar-event';
import { GridWindow } from '../calendar-grid';
import { TimeGrid } from './time-grid';

/** A week from its Sunday — the page's days, as the router gives them. */
const week = (day: string): IsoDay[] => {
  const sunday = startOfWeek(DateTime.fromISO(day), 7);
  return Array.from({ length: 7 }, (_, i) => isoDay(sunday.plus({ days: i })));
};

const LUNCH: CalendarEvent = {
  id: 'lunch',
  title: 'Lunch',
  start: '2026-10-28T13:00',
  end: '2026-10-28T14:00',
  allDay: false,
  color: 'peacock',
  location: '',
  description: '',
};

/** Tea the day after, a little later; dinner that evening, apart. */
const TEA: CalendarEvent = {
  ...LUNCH,
  id: 'tea',
  title: 'Tea',
  start: '2026-10-29T13:30',
  end: '2026-10-29T14:30',
};
const DINNER: CalendarEvent = {
  ...LUNCH,
  id: 'dinner',
  title: 'Dinner',
  start: '2026-10-29T19:00',
  end: '2026-10-29T20:00',
};

/** A fair all Thursday: a bar in the band. */
const FAIR: CalendarEvent = {
  ...LUNCH,
  id: 'fair',
  title: 'Fair',
  allDay: true,
  start: '2026-10-29T00:00',
  end: '2026-10-30T00:00',
};

@Component({
  imports: [TimeGrid],
  template: `
    <div style="display: flex; flex-direction: column; inline-size: 800px; block-size: 460px">
      <calendar-time-grid
        style="flex: 1; min-block-size: 0"
        [days]="days()"
        [events]="events"
        [today]="days()[0]"
        [now]="now"
        [(scrollTop)]="scrollTop"
        (create)="created.push($event.draft)"
        (change)="changed.push($event)"
        (rangeChange)="follow($event)"
        (windowChange)="windows.push($event)"
        (selectMany)="many.push($event)"
        (selectToggle)="toggled.push($event)"
      />
    </div>
  `,
})
class Host {
  readonly days = signal(week('2026-10-25'));
  readonly events = [LUNCH, TEA, DINNER, FAIR];
  readonly now = DateTime.fromISO('2026-10-25T08:00');
  /** Noon at the top: room to scroll both ways. */
  readonly scrollTop = signal<number | null>(12 * 48);
  readonly created: CalendarEventDraft[] = [];
  readonly changed: CalendarEvent[] = [];
  readonly windows: GridWindow[] = [];
  readonly many: (readonly string[])[] = [];
  readonly toggled: string[] = [];
  /** Where the strip slid to, and when. */
  readonly ranges: { day: IsoDay; at: number }[] = [];

  /** The page's follow: its path goes where the strip went. */
  follow(day: IsoDay): void {
    this.ranges.push({ day, at: performance.now() });
    this.days.set(week(day));
  }
}

describe('TimeGrid (render) — the strip', () => {
  let fixture: ComponentFixture<Host>;

  const host = () => fixture.componentInstance;
  const root = () => fixture.nativeElement as HTMLElement;
  const scroller = () => root().querySelector<HTMLElement>('.time-grid__scroller')!;
  const columns = () => root().querySelector<HTMLElement>('.time-grid__columns')!;
  const gutter = () => root().querySelector<HTMLElement>('.time-grid__gutter')!;
  const top = () => root().querySelector<HTMLElement>('.time-grid__top')!;
  const day = (iso: IsoDay) =>
    root().querySelector<HTMLElement>(`.time-grid__day[data-day="${iso}"]`)!;
  /** The days' room in view, across, and the hours' down. */
  const view = () => {
    const box = scroller().getBoundingClientRect();
    return {
      left: gutter().getBoundingClientRect().right,
      right: box.left + scroller().clientWidth,
      top: top().getBoundingClientRect().bottom,
      bottom: box.top + scroller().clientHeight,
    };
  };
  /** The first day in view: the one at the gutter's edge. */
  const firstInView = () =>
    [...root().querySelectorAll<HTMLElement>('.time-grid__day')].find(
      (one) => Math.abs(one.getBoundingClientRect().left - view().left) < 2,
    )?.dataset['day'];
  /** The middle of a day's column in view (0: the first). */
  const dayX = (i: number) => {
    const { left, right } = view();
    return left + ((right - left) / 7) * (i + 0.5);
  };
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const settle = async (ms: number) => {
    await wait(ms);
    await fixture.whenStable();
    await frame();
  };

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

  const chip = (id: string) => root().querySelector<HTMLElement>(`[data-event-id="${id}"]`)!;
  const shifted = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        shiftKey: true,
        button: type === 'pointermove' ? -1 : 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: x,
        clientY: y,
      }),
    );

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideTranslateService()] });
    fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    await settle(100);
    // A synthetic pointer is no live one to capture.
    columns().setPointerCapture = () => {};
  });

  afterEach(() => fixture.nativeElement.remove());

  it('stands where the page is, an interval either side drawn — and asks for those days', () => {
    expect(firstInView()).toBe('2026-10-25');
    // A week in view, a week either side, and the day half in at the end.
    const drawn = root().querySelectorAll('.time-grid__day').length;
    expect(drawn).toBeGreaterThanOrEqual(21);
    expect(drawn).toBeLessThanOrEqual(23);
    expect(host().windows.at(-1)).toEqual({ from: '2026-10-18', to: '2026-11-08' });
    // Every day the hours' whole height — its lines drawn, its empty room
    // there to press.
    expect(day('2026-10-28').getBoundingClientRect().height).toBe(24 * 48);
    expect(columns().getBoundingClientRect().height).toBe(24 * 48);
    expect(host().ranges).toEqual([]);
  });

  it('follows the page straight there — and the page the strip, scrolled', async () => {
    host().days.set(week('2026-12-02'));
    await settle(100);
    expect(firstInView()).toBe('2026-11-29');
    expect(host().ranges).toEqual([]);

    scroller().scrollBy({ left: (view().right - view().left) * 0.8 });
    await settle(900);
    // Eased on to the nearest day's start; the page follows the week most
    // in view.
    expect(firstInView()).toBe('2026-12-05');
    expect(host().ranges.map(({ day }) => day)).toEqual(['2026-12-06']);
  });

  it('marks on down the hours, held past their foot — fast', async () => {
    const before = scroller().scrollTop;
    const { bottom } = view();
    const y = view().top + 40;
    pointer(day('2026-10-28'), 'pointerdown', dayX(3), y);
    pointer(columns(), 'pointermove', dayX(3), y + 40);
    pointer(columns(), 'pointermove', dayX(3), bottom + 40);
    await wait(250);
    pointer(columns(), 'pointerup', dayX(3), bottom + 40);

    // At the edge, thirty hours a second: over four in a quarter second.
    expect(scroller().scrollTop - before).toBeGreaterThan(4 * 48);
    const [draft] = host().created;
    expect(draft.start.slice(0, 10)).toBe('2026-10-28');
    expect(draft.end >= '2026-10-28T21:00').toBe(true);
  });

  it('marks out room pressed where the hours are drawn — found by the pointer, not handed to it', async () => {
    const y = view().top + 80;
    // Monday: inside the test page's own narrow viewport.
    const under = document.elementFromPoint(dayX(1), y)!;
    expect(under.closest('.time-grid__day')?.getAttribute('data-day')).toBe('2026-10-26');
    pointer(under, 'pointerdown', dayX(1), y);
    pointer(columns(), 'pointermove', dayX(1), y + 60);
    pointer(columns(), 'pointerup', dayX(1), y + 60);
    expect(host().created.length).toBe(1);
  });

  it('selects the events a Shift drag covers — across days, lit as it goes — and draws its box', async () => {
    const lunch = chip('lunch').getBoundingClientRect();
    const tea = chip('tea').getBoundingClientRect();
    shifted(day('2026-10-28'), 'pointerdown', dayX(3), lunch.top - 20);
    shifted(columns(), 'pointermove', dayX(4), tea.bottom + 10);
    await settle(50);

    expect(chip('lunch').getAttribute('aria-current')).toBe('true');
    expect(chip('tea').getAttribute('aria-current')).toBe('true');
    expect(chip('dinner').getAttribute('aria-current')).toBeNull();
    const box = root().querySelector<HTMLElement>('.time-grid__marquee')!.getBoundingClientRect();
    expect(Math.round(box.top)).toBe(Math.round(lunch.top - 20));
    expect(Math.round(box.bottom)).toBe(Math.round(tea.bottom + 10));
    // Nothing marked out: a marquee makes no event.
    expect(root().querySelector('[data-event-id="draft"]')).toBeNull();

    shifted(columns(), 'pointerup', dayX(4), tea.bottom + 10);
    await settle(50);
    expect(host().many.map((ids) => [...ids].sort())).toEqual([['lunch', 'tea']]);
    expect(host().created).toEqual([]);
    expect(root().querySelector('.time-grid__marquee')).toBeNull();
  });

  it('takes in the band when a Shift drag goes up over it — and the hours up to the first in view', async () => {
    const lunch = chip('lunch').getBoundingClientRect();
    const fair = chip('fair').getBoundingClientRect();
    shifted(day('2026-10-28'), 'pointerdown', dayX(3), lunch.bottom + 20);
    shifted(columns(), 'pointermove', dayX(4), fair.top + 5);
    await settle(50);

    for (const id of ['fair', 'lunch', 'tea']) {
      expect(chip(id).getAttribute('aria-current')).toBe('true');
    }
    expect(chip('dinner').getAttribute('aria-current')).toBeNull();
    // Two boxes: the band's, the band's whole height; the hours', from the
    // first in view down to where it was pressed.
    const band = root().querySelector<HTMLElement>('.time-grid__marquee--band')!;
    const bandRow = root().querySelector<HTMLElement>('.time-grid__band')!.getBoundingClientRect();
    expect(Math.round(band.getBoundingClientRect().height)).toBeGreaterThanOrEqual(
      Math.round(bandRow.height),
    );
    const hours = root()
      .querySelector<HTMLElement>('.time-grid__marquee:not(.time-grid__marquee--band)')!
      .getBoundingClientRect();
    expect(Math.round(hours.top)).toBe(Math.round(view().top));
    expect(Math.round(hours.bottom)).toBe(Math.round(lunch.bottom + 20));

    shifted(columns(), 'pointerup', dayX(4), fair.top + 5);
    await settle(50);
    expect(host().many.map((ids) => [...ids].sort())).toEqual([['fair', 'lunch', 'tea']]);
  });

  it('toggles a bar in the band pressed with Shift, never dragged', async () => {
    const fair = chip('fair').getBoundingClientRect();
    shifted(chip('fair'), 'pointerdown', fair.left + 10, fair.top + 5);
    shifted(columns(), 'pointerup', fair.left + 10, fair.top + 5);
    await settle(50);
    expect(host().toggled).toEqual(['fair']);
    expect(host().created).toEqual([]);
  });

  it('toggles an event pressed with Shift, never dragged', async () => {
    const lunch = chip('lunch').getBoundingClientRect();
    const x = lunch.left + 10;
    const y = lunch.top + 10;
    shifted(chip('lunch'), 'pointerdown', x, y);
    shifted(columns(), 'pointerup', x, y);
    await settle(50);
    expect(host().toggled).toEqual(['lunch']);
    expect(host().many).toEqual([]);
    expect(host().changed).toEqual([]);
  });

  it('stays put while the pointer is clear of the edges', async () => {
    const before = { top: scroller().scrollTop, left: scroller().scrollLeft };
    const y = view().top + 80;
    pointer(day('2026-10-28'), 'pointerdown', dayX(3), y);
    pointer(columns(), 'pointermove', dayX(4), y + 60);
    await settle(400);
    pointer(columns(), 'pointerup', dayX(4), y + 60);
    expect({ top: scroller().scrollTop, left: scroller().scrollLeft }).toEqual(before);
    expect(host().ranges).toEqual([]);
  });

  it('slides to the next week as a mark reaches the days’ end — it runs on into it', async () => {
    const y = view().top + 80;
    const start = scroller().scrollLeft;
    pointer(day('2026-10-28'), 'pointerdown', dayX(3), y);
    pointer(columns(), 'pointermove', dayX(4), y);
    pointer(columns(), 'pointermove', view().right + 10, y);
    await settle(150);
    // Mid-slide: on its way, smoothly — not there at once.
    const mid = scroller().scrollLeft;
    expect(mid).toBeGreaterThan(start);
    await settle(500);
    pointer(columns(), 'pointerup', view().right + 10, y);

    expect(host().ranges.map(({ day }) => day)).toEqual(['2026-11-01']);
    expect(firstInView()).toBe('2026-11-01');
    const [draft] = host().created;
    // From the Wednesday pressed to the next week's Saturday, under the
    // pointer — the last day in view, never one drawn out of sight.
    expect(draft.start.slice(0, 10)).toBe('2026-10-28');
    expect(draft.end.slice(0, 10)).toBe('2026-11-07');
  });

  it('moves an event into the week before, held at the days’ start', async () => {
    const chip = root().querySelector<HTMLElement>('[data-event-id="lunch"]')!;
    const box = chip.getBoundingClientRect();
    const y = box.top + 10;
    pointer(chip, 'pointerdown', box.left + 20, y);
    pointer(columns(), 'pointermove', dayX(2), y);
    pointer(columns(), 'pointermove', view().left - 10, y);
    await settle(650);
    pointer(columns(), 'pointerup', view().left - 10, y);

    expect(host().ranges.map(({ day }) => day)).toEqual(['2026-10-18']);
    const [moved] = host().changed;
    // To the Sunday at the days' start, at the same time of day.
    expect([moved.start, moved.end]).toEqual(['2026-10-18T13:00', '2026-10-18T14:00']);
  });

  it('slides on, a week each 820ms, while held at the side', async () => {
    const y = view().top + 80;
    pointer(day('2026-10-28'), 'pointerdown', dayX(3), y);
    pointer(columns(), 'pointermove', view().right + 10, y);
    await settle(1100);
    pointer(columns(), 'pointerup', view().right + 10, y);
    await settle(600);
    expect(host().ranges.map(({ day }) => day)).toEqual(['2026-11-01', '2026-11-08']);
    const times = host().ranges.map(({ at }) => at);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(600);
  });

  it('slides nothing on the last day, short of its edge', async () => {
    const y = view().top + 80;
    pointer(day('2026-10-28'), 'pointerdown', dayX(3), y);
    pointer(columns(), 'pointermove', view().right - 48, y);
    await settle(1000);
    pointer(columns(), 'pointerup', view().right - 48, y);
    expect(host().ranges).toEqual([]);
    expect(host().created[0].end.slice(0, 10)).toBe('2026-10-31');
  });
});
