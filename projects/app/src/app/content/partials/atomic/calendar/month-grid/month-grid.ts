import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { TranslatePipe } from '@ngx-translate/core';

import { IsoDay, daysBetween, parseDay } from '../../../../../core/calendar/calendar-dates';
import {
  CalendarEvent,
  DRAFT_ID,
  EventEdit,
  draftAt,
  editAsEvent,
  eventSpan,
  inBand,
  movedTo,
} from '../../../../../core/calendar/calendar-event';
import { CalendarFormat } from '../../../../../core/calendar/calendar-format';
import { placeInLanes } from '../../../../../core/calendar/calendar-layout';
import { EventChip } from '../../../shared/calendar/event-chip/event-chip';
import { DRAG_THRESHOLD, GridCreate, GridOpen, boxOf, GridSlot, headOf } from '../calendar-grid';

/** A row's sizes, px: the date's line, and a lane (22 + 2 apart). */
const DATE_LINE = 28;
const LANE = 24;

/** A drag across the month: an event picked up and carried to a day, or
    days marked out for a new one. */
interface Drag {
  kind: 'move' | 'days';
  pointer: number;
  x: number;
  y: number;
  moved: boolean;
  /** The day it was picked up (or pressed) on, and the event as it would
      drop — for days, the new one as marked so far. */
  from: IsoDay;
  stored: CalendarEvent;
  preview: CalendarEvent;
  /** The event's chip, for a press: the grid holds the pointer, so the
      click lands on the grid, never on it. */
  element: Element;
}

/**
 * The month, Google Calendar's: its weeks, every day a cell of its date and
 * its events — bars for the ones across days and all day, a dot, a time and
 * a title for a timed one — as many lanes as the cell has room for, the
 * rest behind "+2 more" (which opens the day). Days of the months either
 * side are faint, today's date a filled circle.
 *
 * Press a day and it holds a new all-day event (`create`) — drag sideways,
 * or down a week, and the mark runs over every day between, Notion's; the
 * card opens by its first day. Press its date
 * and that day opens alone (`dayOpen`); press an event and it opens
 * (`open`); carry one to another day and it moves there, its time kept
 * (`change`).
 *
 * How many lanes fit is the one thing measured: the rows' height, when the
 * grid's size changes (a ResizeObserver), never per event.
 */
@Component({
  selector: 'calendar-month-grid',
  imports: [EventChip, TranslatePipe],
  templateUrl: './month-grid.html',
  styleUrl: './month-grid.scss',
  host: {
    '[style.--weeks]': 'weeks().length',
    '[style.--cols]': 'weeks()[0]?.length ?? 7',
    '[class.month-grid--dragging]': 'dragging()',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'release($event)',
    '(pointercancel)': 'cancel()',
  },
})
export class MonthGrid {
  readonly #formats = inject(CalendarFormat).formats;
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly weeks = input.required<readonly (readonly IsoDay[])[]>();
  /** A day of the month shown: the others are faint. None for a run of
      weeks (Google's custom weeks): every day is as much its own. */
  readonly month = input<IsoDay | null>(null);
  readonly events = input.required<readonly CalendarEvent[]>();
  readonly draft = input<EventEdit | null>(null);
  readonly today = input.required<IsoDay>();
  readonly untitled = input('');

  readonly create = output<GridCreate>();
  readonly open = output<GridOpen>();
  readonly change = output<CalendarEvent>();
  readonly dayOpen = output<IsoDay>();

  /** How many lanes a week's row has room for. */
  readonly #lanes = signal(3);

  readonly #drag = signal<Drag | null>(null);
  protected readonly dragging = computed(() => !!this.#drag()?.moved);
  #swallowClick = false;

  readonly #shown = computed(() => {
    const drag = this.#drag();
    const draft = this.draft();
    const replaced = drag?.moved ? drag.preview : draft ? editAsEvent(draft) : null;
    const events = this.events().filter((event) => event.id !== replaced?.id);
    return replaced ? [...events, replaced] : events;
  });

  protected readonly weekdays = computed(() => {
    const formats = this.#formats();
    return this.weeks()[0].map((day) => ({ day, label: formats.weekday(parseDay(day)!) }));
  });

  protected readonly rows = computed(() => {
    const formats = this.#formats();
    const month = parseDay(this.month());
    const today = this.today();
    const shown = this.#shown();
    const capacity = this.#lanes();
    const drag = this.#drag();
    const lifted = drag?.moved ? drag.preview.id : null;

    return this.weeks().map((week) => {
      const placed = placeInLanes(shown, week, 'all');
      const overflowing = placed.some((one) => one.lane >= capacity);
      // With more than fits, the last lane says how many more.
      const visible = overflowing ? Math.max(capacity - 1, 0) : capacity;
      const hidden = week.map(() => 0);
      for (const one of placed) {
        if (one.lane < visible) continue;
        for (let day = one.from; day < one.from + one.span; day++) hidden[day]++;
      }
      return {
        key: week[0],
        days: week.map((day, i) => {
          const date = parseDay(day)!;
          return {
            day,
            column: i + 1,
            number: date.day === 1 ? formats.shortDay(date) : String(date.day),
            label: formats.longDay(date),
            outside: !!month && !date.hasSame(month, 'month'),
            weekend: date.weekday > 5,
            today: day === today,
            more: hidden[i],
          };
        }),
        moreRow: visible + 2,
        chips: placed
          .filter((one) => one.lane < visible)
          .map((one) => ({
            ...one,
            key: one.event.id,
            shape: inBand(one.event) ? ('bar' as const) : ('item' as const),
            column: `${one.from + 1} / span ${one.span}`,
            row: one.lane + 2,
            // A new one, marked out — Notion's selection.
            mark: one.event.id === DRAFT_ID,
            lifted: one.event.id === lifted,
          })),
      };
    });
  });

  constructor() {
    // The lanes a row has room for: its height under the date's line.
    afterNextRender({
      read: () => {
        const observer = new ResizeObserver(() => {
          const row = this.#host.querySelector('.month-grid__week');
          if (!row) return;
          const height = row.getBoundingClientRect().height;
          this.#lanes.set(Math.max(1, Math.floor((height - DATE_LINE - 4) / LANE)));
        });
        observer.observe(this.#host);
        this.#destroyRef.onDestroy(() => observer.disconnect());
      },
    });
  }

  readonly #destroyRef = inject(DestroyRef);

  protected dateOpen(day: IsoDay): void {
    this.dayOpen.emit(day);
  }

  /** A press on a day's empty room: a new all-day event's mark begins
      there — that day, or every day the drag goes over. */
  protected pressDay(event: PointerEvent, day: IsoDay): void {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    if (event.pointerType !== 'touch') {
      this.#host.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    const mark = editAsEvent(draftAt(parseDay(day)!, { allDay: true }));
    this.#drag.set({
      kind: 'days',
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      from: day,
      stored: mark,
      preview: mark,
      element: event.currentTarget as Element,
    });
  }

  protected pressEvent(event: PointerEvent, shown: CalendarEvent, day: IsoDay): void {
    // A holiday (read-only) opens on its click; it never moves.
    if (
      event.button !== 0 ||
      event.pointerType === 'touch' ||
      shown.id === DRAFT_ID ||
      shown.readonly
    ) {
      return;
    }
    const stored = this.events().find((one) => one.id === shown.id);
    if (!stored) return;
    // The day it was picked up on: the one under the pointer.
    const under = this.#dayAt(event) ?? day;
    this.#host.setPointerCapture(event.pointerId);
    this.#drag.set({
      kind: 'move',
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      from: under,
      stored,
      preview: stored,
      element: event.currentTarget as Element,
    });
  }

  /** The day under a pointer, the whole of it — for what the page puts
      there (a paste). */
  slotAt(event: MouseEvent): GridSlot | null {
    const day = this.#dayAt(event);
    return day ? { day, minute: null } : null;
  }

  #dayAt(event: MouseEvent): IsoDay | null {
    const hit = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element) => element.matches('.month-grid__cell'));
    return (hit as HTMLElement | undefined)?.dataset['day'] ?? null;
  }

  protected move(event: PointerEvent): void {
    const drag = this.#drag();
    if (!drag || drag.pointer !== event.pointerId) return;
    const moved =
      drag.moved || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > DRAG_THRESHOLD;
    if (!moved) return;
    if (event.pointerType === 'touch') return this.#drag.set(null);
    const day = this.#dayAt(event);
    if (!day) return this.#drag.set({ ...drag, moved });
    if (drag.kind === 'days') {
      const [from, to] = [drag.from, day].sort();
      const days = daysBetween(parseDay(from)!, parseDay(to)!) + 1;
      const mark = { ...drag.stored, ...draftAt(parseDay(from)!, { allDay: true, days }) };
      return this.#drag.set({ ...drag, moved, preview: mark });
    }
    const shift = daysBetween(parseDay(drag.from)!, parseDay(day)!);
    const start = eventSpan(drag.stored).start.plus({ days: shift });
    this.#drag.set({ ...drag, moved, preview: movedTo(drag.stored, start) });
  }

  protected release(event: PointerEvent): void {
    const drag = this.#drag();
    if (!drag || drag.pointer !== event.pointerId) return;
    this.#drag.set(null);
    // A press opens the event here: the grid held the pointer, so the
    // click it ends with lands on the grid — and is spent, as a drag's is.
    this.#swallowClick = true;
    setTimeout(() => (this.#swallowClick = false));
    if (drag.kind === 'days') {
      // The card opens by the mark's first day.
      const { id: _, ...draft } = drag.preview;
      const first = this.#host.querySelector(
        `.month-grid__cell[data-day="${drag.preview.start.slice(0, 10)}"]`,
      );
      this.create.emit({ draft, rect: boxOf(first ?? drag.element) });
      return;
    }
    if (!drag.moved) {
      this.open.emit({ id: drag.stored.id, rect: headOf(drag.element) });
      return;
    }
    if (drag.preview.start !== drag.stored.start) this.change.emit(drag.preview);
  }

  protected cancel(): void {
    this.#drag.set(null);
  }

  protected clicked(event: MouseEvent, shown: CalendarEvent): void {
    if (this.#swallowClick) {
      this.#swallowClick = false;
      return;
    }
    if (shown.id === DRAFT_ID) return;
    this.open.emit({ id: shown.id, rect: headOf(event.currentTarget as Element) });
  }
}
