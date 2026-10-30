import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DateTime } from 'luxon';

import { AnchorRect } from '@h-k-dev/angular-email-editor/anchor';
import { TranslatePipe } from '@ngx-translate/core';

import {
  DAY_MINUTES,
  IsoDay,
  daysBetween,
  isoDay,
  isoMoment,
  minuteOfDay,
  parseDay,
  snapMinutes,
} from '../../../../../core/calendar/calendar-dates';
import {
  CalendarEvent,
  DEFAULT_EVENT_MINUTES,
  DRAFT_ID,
  EventEdit,
  draftAt,
  editAsEvent,
  eventSpan,
  movedTo,
} from '../../../../../core/calendar/calendar-event';
import { CalendarFormat } from '../../../../../core/calendar/calendar-format';
import { laneCount, placeInDay, placeInLanes } from '../../../../../core/calendar/calendar-layout';
import { EventChip } from '../../../shared/calendar/event-chip/event-chip';
import { DRAG_THRESHOLD, GridCreate, GridOpen, boxOf } from '../calendar-grid';

/** An hour's height, px — the one size the grid's minutes are multiplied
    by (set on the host as `--hour`). */
export const HOUR_HEIGHT = 48;

/** The step a press and a drag snap to, minutes — Notion's quarter hour. */
const SNAP = 15;

/** A drag on the hours: marking out a new event — in the hours, or whole
    days in the band — moving one, or stretching its end. */
interface Drag {
  kind: 'mark' | 'days' | 'move' | 'resize';
  pointer: number;
  x: number;
  y: number;
  /** Whether it went past the threshold — a press otherwise. */
  moved: boolean;
  /** The event as it would be dropped now. */
  preview: CalendarEvent;
  /** mark: the minute it was pressed at, on its day. move: the minutes
      from the event's start to where it was picked up. days: unused —
      `day` is where it was pressed. */
  anchor: number;
  day: number;
  /** The event's chip, for a press: the grid holds the pointer, so the
      click lands on the grid, never on it. */
  element?: Element;
}

/**
 * A day's or a week's hours, Notion Calendar's: the days' heads on top, the
 * band of all-day (and overnight) events under them, and the hours below —
 * the one scroller — each day a column its timed events stand in, side by
 * side where they overlap. A line marks the quarter hour under the
 * pointer, one in the theme's primary now.
 *
 * Press an hour and drag, and the time is marked out as you go — Notion's
 * selection, the colour at an eighth, its times in it; drag sideways and
 * it runs on across the days between, shown in each (and in the band,
 * whole days); let go and it is a
 * new event's room (`create`), with the box to open its card beside. The
 * mark stays while the card is open, and is itself a thing to drag: move
 * it, stretch its foot (`draftChange`). A press anywhere else marks out
 * the next one at once. Press an event and it opens (`open`); drag it —
 * across days too — and it moves, drag its foot and it stretches
 * (`change`). Everything in quarter hours, where the pointer is, at once:
 * no motion.
 *
 * Lays out numbers, never measures events: minutes × `--hour`.
 */
@Component({
  selector: 'calendar-time-grid',
  imports: [EventChip, TranslatePipe],
  templateUrl: './time-grid.html',
  styleUrl: './time-grid.scss',
  host: {
    '[style.--hour.px]': 'hourHeight',
    '[style.--days]': 'days().length',
    '[class.time-grid--dragging]': 'dragging()',
    '(document:keydown.escape)': 'escape($event)',
  },
})
export class TimeGrid {
  readonly #formats = inject(CalendarFormat).formats;

  readonly days = input.required<readonly IsoDay[]>();
  readonly events = input.required<readonly CalendarEvent[]>();
  /** The event being written, shown where it will be. */
  readonly draft = input<EventEdit | null>(null);
  readonly today = input.required<IsoDay>();
  readonly now = input.required<DateTime>();
  readonly untitled = input('');
  /** Where the hours are scrolled to, px — kept by the page, so the month
      and back opens at the same hour; null until first scrolled. */
  readonly scrollTop = model<number | null>(null);

  readonly create = output<GridCreate>();
  readonly open = output<GridOpen>();
  readonly change = output<CalendarEvent>();
  /** The new event's mark was moved or stretched: its times, and its box. */
  readonly draftChange = output<GridCreate>();
  /** A day's head was pressed: that day, alone. */
  readonly dayOpen = output<IsoDay>();

  protected readonly hourHeight = HOUR_HEIGHT;

  protected readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  protected readonly columnsEl = viewChild.required<ElementRef<HTMLElement>>('dayColumns');
  protected readonly bandEl = viewChild.required<ElementRef<HTMLElement>>('bandDays');

  readonly #drag = signal<Drag | null>(null);
  protected readonly dragging = computed(() => !!this.#drag()?.moved);
  /** A drag or a press just ended: the click that follows is spent. */
  #swallowClick = false;

  /** The quarter hour under a mouse, while nothing is dragged. */
  readonly #hover = signal<{ day: number; minute: number } | null>(null);

  /** What the grid lays out: the stored events, the one being written in
      place of its stored self, the one being dragged as it would drop. */
  readonly #shown = computed(() => {
    const drag = this.#drag();
    const draft = this.draft();
    const replaced = drag?.moved ? drag.preview : draft ? editAsEvent(draft) : null;
    const events = this.events().filter((event) => event.id !== replaced?.id);
    return replaced ? [...events, replaced] : events;
  });

  /** The one being dragged, lifted. */
  readonly #lifted = computed(() => {
    const drag = this.#drag();
    return drag?.moved && drag.preview.id !== DRAFT_ID ? drag.preview.id : null;
  });

  protected readonly zone = computed(() => {
    const formats = this.#formats();
    return this.now().setLocale(formats.language).offsetNameShort ?? '';
  });

  protected readonly heads = computed(() => {
    const formats = this.#formats();
    const today = this.today();
    return this.days().map((day) => {
      const date = parseDay(day)!;
      return {
        day,
        weekday: formats.weekday(date),
        number: date.day,
        label: formats.longDay(date),
        today: day === today,
        weekend: date.weekday > 5,
      };
    });
  });

  /** The hours' labels, from 1 — midnight goes unsaid. The one now is
      over hides itself: now's own time stands there in primary. */
  protected readonly hours = computed(() => {
    const formats = this.#formats();
    const midnight = parseDay(this.days()[0])!;
    const now = this.days().includes(this.today()) ? minuteOfDay(this.now()) : null;
    return Array.from({ length: 23 }, (_, i) => ({
      hour: i + 1,
      label: formats.time(midnight.set({ hour: i + 1 })),
      hidden: now !== null && Math.abs(now - (i + 1) * 60) < 15,
    }));
  });

  /** Now, in the gutter: its time, in primary, where the line runs. */
  protected readonly nowLabel = computed(() => {
    if (!this.days().includes(this.today())) return null;
    const now = this.now();
    return {
      top: minuteOfDay(now),
      label: now.toLocaleString(DateTime.TIME_SIMPLE, { locale: this.#formats().language }),
    };
  });

  protected readonly band = computed(() => {
    const lifted = this.#lifted();
    // A timed mark across days stays in the hours, shown in each day.
    const shown = this.#shown().filter((event) => event.id !== DRAFT_ID || event.allDay);
    const placed = placeInLanes(shown, this.days(), 'band');
    return {
      lanes: Math.max(laneCount(placed), 1),
      bars: placed.map((one) => ({
        ...one,
        key: one.event.id,
        mark: one.event.id === DRAFT_ID,
        lifted: one.event.id === lifted,
      })),
    };
  });

  protected readonly columns = computed(() => {
    const lifted = this.#lifted();
    const shown = this.#shown();
    const events = shown.filter((event) => event.id !== DRAFT_ID);
    const mark = shown.filter((event) => event.id === DRAFT_ID);
    const today = this.today();
    const now = this.now();
    const heads = this.heads();
    return this.days().map((day, i) => ({
      day,
      weekend: heads[i].weekend,
      now: day === today ? minuteOfDay(now) : null,
      events: [
        ...placeInDay(events, day).map((one) => ({
          ...one,
          key: one.event.id,
          // A short block has room for one line: the title alone.
          lines: one.length < 45 ? 1 : Math.max(1, Math.floor((one.length / 60) * 2.4) - 1),
          mark: false,
          lifted: one.event.id === lifted,
        })),
        // The mark over them all, the column's whole width: Notion's.
        ...placeInDay(mark, day, { spanning: true }).map((one) => ({
          ...one,
          key: one.event.id,
          lines: 1,
          mark: true,
          lifted: false,
        })),
      ],
    }));
  });

  /** The quarter hour line under the mouse: its day and minute. */
  protected readonly hoverLine = computed(() => (this.#drag() ? null : this.#hover()));

  constructor() {
    // The hours open where they were — or an hour and a half before now,
    // or at 7 in the morning on a day without one.
    afterNextRender({
      write: () => {
        const scroller = this.scroller().nativeElement;
        const kept = this.scrollTop();
        const now = this.days().includes(this.today()) ? minuteOfDay(this.now()) - 90 : 7 * 60;
        scroller.scrollTop = kept ?? Math.max(0, (now / 60) * HOUR_HEIGHT);
      },
    });
  }

  protected scrolled(event: Event): void {
    this.scrollTop.set((event.target as HTMLElement).scrollTop);
  }

  protected headPressed(day: IsoDay): void {
    this.dayOpen.emit(day);
  }

  // ─── Pointer ────────────────────────────────────────────────────────

  /** The day and minute under the pointer. */
  #at(event: PointerEvent): { day: number; minute: number } {
    const box = this.columnsEl().nativeElement.getBoundingClientRect();
    const count = this.days().length;
    const rtl = getComputedStyle(this.columnsEl().nativeElement).direction === 'rtl';
    const x = rtl ? box.right - event.clientX : event.clientX - box.left;
    const day = Math.min(count - 1, Math.max(0, Math.floor((x / box.width) * count)));
    const minute = Math.min(
      DAY_MINUTES,
      Math.max(0, ((event.clientY - box.top) / HOUR_HEIGHT) * 60),
    );
    return { day, minute };
  }

  #moment(day: number, minute: number): DateTime {
    return parseDay(this.days()[day])!.plus({ minutes: minute });
  }

  /** A press on an empty hour: a new event's mark begins at its quarter. */
  protected pressHours(event: PointerEvent): void {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const { day, minute } = this.#at(event);
    const anchor = Math.min(DAY_MINUTES - SNAP, Math.floor(minute / SNAP) * SNAP);
    this.#begin(event, {
      kind: 'mark',
      anchor,
      day,
      // A press alone marks Notion's default: an hour from the quarter.
      preview: editAsEvent(
        draftAt(this.#moment(day, anchor), {
          minutes: Math.min(DEFAULT_EVENT_MINUTES, DAY_MINUTES - anchor),
        }),
      ),
    });
  }

  /** The event a chip shows, as it is stored — or the mark, as written. */
  #source(shown: CalendarEvent): CalendarEvent | null {
    if (shown.id === DRAFT_ID) {
      const draft = this.draft();
      return draft ? editAsEvent(draft) : null;
    }
    return this.events().find((one) => one.id === shown.id) ?? null;
  }

  /** A press on an event (or the mark): a press opens it, a drag moves it. */
  protected pressEvent(event: PointerEvent, shown: CalendarEvent): void {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const source = this.#source(shown);
    if (!source) return;
    const { day, minute } = this.#at(event);
    const start = eventSpan(source).start;
    const startMinute = (start.toMillis() - parseDay(this.days()[day])!.toMillis()) / 60_000;
    this.#begin(event, {
      kind: 'move',
      anchor: minute - startMinute,
      day,
      preview: source,
      element: event.currentTarget as Element,
    });
  }

  /** A press on an event's foot (or the mark's): a drag stretches it. */
  protected pressFoot(event: PointerEvent, shown: CalendarEvent): void {
    if (event.button !== 0) return;
    const source = this.#source(shown);
    if (!source) return;
    event.stopPropagation();
    const { day } = this.#at(event);
    this.#begin(event, { kind: 'resize', anchor: 0, day, preview: source });
  }

  #begin(
    event: PointerEvent,
    drag: Pick<Drag, 'kind' | 'anchor' | 'day' | 'preview' | 'element'>,
  ): void {
    // A finger scrolls the hours; only a press without travel is meant.
    if (event.pointerType !== 'touch') {
      this.columnsEl().nativeElement.setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    this.#drag.set({
      ...drag,
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    });
  }

  protected move(event: PointerEvent): void {
    const drag = this.#drag();
    if (!drag) {
      if (event.pointerType === 'mouse') this.#hoverAt(event);
      return;
    }
    if (drag.pointer !== event.pointerId) return;
    const moved =
      drag.moved || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > DRAG_THRESHOLD;
    if (!moved) return;
    if (event.pointerType === 'touch') {
      // The finger scrolls: no drag.
      this.#drag.set(null);
      return;
    }
    const { day, minute } = this.#at(event);
    this.#drag.set({ ...drag, moved, preview: this.#previewAt(drag, day, minute) });
  }

  #hoverAt(event: PointerEvent): void {
    const over = (event.target as Element).closest('.time-grid__day');
    if (!over || event.target !== over) return this.#hover.set(null);
    const { day, minute } = this.#at(event);
    const quarter = Math.min(DAY_MINUTES - SNAP, Math.floor(minute / SNAP) * SNAP);
    const hover = this.#hover();
    if (hover?.day !== day || hover.minute !== quarter) this.#hover.set({ day, minute: quarter });
  }

  protected leave(): void {
    this.#hover.set(null);
  }

  #previewAt(drag: Drag, day: number, minute: number): CalendarEvent {
    const snapped = snapMinutes(minute, SNAP);
    if (drag.kind === 'mark') {
      // From the quarter pressed to the one the pointer is at — on its day:
      // sideways, Notion's, the mark runs across the days between. Either
      // way; a quarter at the least.
      const pressed = this.#moment(drag.day, drag.anchor);
      const pointer = this.#moment(day, snapped);
      const [start, end] =
        pointer >= pressed
          ? [pressed, DateTime.max(pointer, pressed.plus({ minutes: SNAP }))]
          : [pointer, pressed.plus({ minutes: SNAP })];
      return { ...drag.preview, start: isoMoment(start), end: isoMoment(end) };
    }
    if (drag.kind === 'days') {
      // Whole days, from the one pressed to the one the pointer is over.
      // By the calendar: a run over hidden weekends holds them too.
      const from = this.#moment(Math.min(drag.day, day), 0);
      const to = this.#moment(Math.max(drag.day, day), 0);
      const days = daysBetween(from, to) + 1;
      return { ...drag.preview, ...draftAt(from, { allDay: true, days }) };
    }
    if (drag.kind === 'move') {
      const start = Math.min(
        DAY_MINUTES - SNAP,
        Math.max(-drag.anchor, snapMinutes(minute - drag.anchor, SNAP)),
      );
      return movedTo(drag.preview, this.#moment(day, Math.max(0, start)));
    }
    const { start } = eventSpan(drag.preview);
    const end = this.#moment(day, snapped);
    return { ...drag.preview, end: isoMoment(DateTime.max(end, start.plus({ minutes: SNAP }))) };
  }

  protected release(event: PointerEvent): void {
    const drag = this.#drag();
    if (!drag || drag.pointer !== event.pointerId) return;
    this.#drag.set(null);
    // The grid held the pointer, so the click this ends with lands on the
    // grid, not on what was pressed: a press is answered here, and the
    // click is spent.
    this.#swallowClick = true;
    setTimeout(() => (this.#swallowClick = false));
    if (event.pointerType === 'mouse') this.#hoverAt(event);

    const { id, ...draft } = drag.preview;
    if (drag.kind === 'mark') {
      this.create.emit({ draft, rect: this.#slotBox(drag.preview) });
      return;
    }
    if (drag.kind === 'days') {
      this.create.emit({ draft, rect: this.#bandBox(drag.preview) });
      return;
    }
    if (id === DRAFT_ID) {
      if (drag.moved) this.draftChange.emit({ draft, rect: this.#slotBox(drag.preview) });
      return;
    }
    if (!drag.moved) {
      if (drag.element) this.open.emit({ id, rect: boxOf(drag.element) });
      return;
    }
    const stored = this.events().find((one) => one.id === id);
    if (stored && (stored.start !== drag.preview.start || stored.end !== drag.preview.end)) {
      this.change.emit(drag.preview);
    }
  }

  protected cancel(): void {
    this.#drag.set(null);
  }

  /** Escape lets go of a drag where it began — and is spent on it. */
  protected escape(event: Event): void {
    if (!this.#drag()) return;
    event.preventDefault();
    this.#drag.set(null);
  }

  /** A click that came by keyboard (Enter, Space): the event opens. */
  protected clicked(event: MouseEvent, shown: CalendarEvent): void {
    if (this.#swallowClick) {
      this.#swallowClick = false;
      return;
    }
    if (shown.id === DRAFT_ID) return;
    this.open.emit({ id: shown.id, rect: boxOf(event.currentTarget as Element) });
  }

  /** A press on the band: an all-day event that day. */
  protected pressBand(event: PointerEvent): void {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    // The band's days line up with the hours' columns: the same tracks.
    const { day } = this.#at(event);
    if (event.pointerType !== 'touch') {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    this.#drag.set({
      kind: 'days',
      anchor: 0,
      day,
      preview: editAsEvent(draftAt(this.#moment(day, 0), { allDay: true })),
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    });
  }

  /** Where days in the band stand on screen — for a new one's card. */
  #bandBox(event: CalendarEvent): AnchorRect {
    const band = this.bandEl().nativeElement.getBoundingClientRect();
    const count = this.days().length;
    const { start, end } = eventSpan(event);
    // By the days shown: weekends hidden leave gaps the box closes over.
    const days = this.days();
    const from = Math.max(days.indexOf(isoDay(start)), 0);
    const last = isoDay(end.minus({ minutes: 1 }));
    let to = count - 1;
    while (to > from && days[to] > last) to--;
    const span = to - from + 1;
    const width = band.width / count;
    const rtl = getComputedStyle(this.bandEl().nativeElement).direction === 'rtl';
    return {
      left: rtl ? band.right - (from + span) * width : band.left + from * width,
      top: band.top,
      width: span * width,
      height: band.height,
    };
  }

  /** Where an event in the hours stands on screen — for its card, before
      (or while) it is drawn. */
  #slotBox(event: CalendarEvent): AnchorRect {
    const box = this.columnsEl().nativeElement.getBoundingClientRect();
    const count = this.days().length;
    const { start, end } = eventSpan(event);
    const day = Math.max(this.days().indexOf(isoDay(start)), 0);
    const width = box.width / count;
    const rtl = getComputedStyle(this.columnsEl().nativeElement).direction === 'rtl';
    // Its first day's part: across days, the card stands by where it begins.
    const last = DateTime.min(end, start.startOf('day').plus({ days: 1 }));
    return {
      left: rtl ? box.right - (day + 1) * width : box.left + day * width,
      top: box.top + (minuteOfDay(start) / 60) * HOUR_HEIGHT,
      width,
      height: (last.diff(start, 'minutes').minutes / 60) * HOUR_HEIGHT,
    };
  }
}
