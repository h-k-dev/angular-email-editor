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

/** The step a drag snaps to, minutes. */
const SNAP = 15;

/** A drag on the hours: marking a new event's room, moving one, or
    stretching its end. */
interface Drag {
  kind: 'create' | 'move' | 'resize';
  pointer: number;
  x: number;
  y: number;
  /** Whether it went past the threshold — a press otherwise. */
  moved: boolean;
  /** The event as it would be dropped now. */
  preview: CalendarEvent;
  /** create: the minute it started at, on its day. move: the minutes from
      the event's start to where it was picked up. */
  anchor: number;
  day: number;
  /** The event's chip, for a press: the grid holds the pointer, so the
      click lands on the grid, never on it. */
  element?: Element;
}

/**
 * A day's or a week's hours, Google Calendar's: the days' heads on top,
 * the band of all-day (and overnight) events under them, and the hours
 * below — the one scroller — each day a column its timed events stand
 * in, side by side where they overlap. A red line marks now.
 *
 * Press an empty hour (or drag down across a few) and room is marked for
 * a new event: `create`, with the box to open its card beside. Press an
 * event and it opens (`open`); drag it — across days too — and it moves,
 * drag its foot and it stretches (`change`), in 15-minute steps, lifted
 * off the grid while it travels and dropped on the spring. The event
 * being written (`draft`) stands in the grid as it will be, dashed.
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
  /** The event just made: it pops in. */
  readonly fresh = input<string | null>(null);
  readonly untitled = input('');
  /** Where the hours are scrolled to, px — kept by the page across turns,
      so next week opens at the same hour; null until first scrolled. */
  readonly scrollTop = model<number | null>(null);

  readonly create = output<GridCreate>();
  readonly open = output<GridOpen>();
  readonly change = output<CalendarEvent>();
  /** A day's head was pressed: that day, alone. */
  readonly dayOpen = output<IsoDay>();

  protected readonly hourHeight = HOUR_HEIGHT;

  protected readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  protected readonly columnsEl = viewChild.required<ElementRef<HTMLElement>>('dayColumns');

  readonly #drag = signal<Drag | null>(null);
  protected readonly dragging = computed(() => !!this.#drag()?.moved);
  /** A drag just ended: the click that follows it is not a press. */
  #swallowClick = false;

  /** What the grid lays out: the stored events, the one being written in
      place of its stored self, the one being dragged as it would drop. */
  readonly #shown = computed(() => {
    const drag = this.#drag();
    const draft = this.draft();
    const replaced = drag?.moved ? drag.preview : draft ? editAsEvent(draft) : null;
    const events = this.events().filter((event) => event.id !== replaced?.id);
    return replaced ? [...events, replaced] : events;
  });

  /** Which shown event is the dashed draft, and which is lifted. */
  readonly #marks = computed(() => {
    const drag = this.#drag();
    const draft = this.draft();
    return {
      ghost:
        drag?.moved && drag.kind === 'create' ? DRAFT_ID : draft ? (draft.id ?? DRAFT_ID) : null,
      lifted: drag?.moved && drag.kind !== 'create' ? drag.preview.id : null,
    };
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
        past: day < today,
      };
    });
  });

  /** The hours' labels, from 1 — midnight goes unsaid, as Google's does. */
  protected readonly hours = computed(() => {
    const formats = this.#formats();
    const midnight = parseDay(this.days()[0])!;
    return Array.from({ length: 23 }, (_, i) => ({
      hour: i + 1,
      label: formats.time(midnight.set({ hour: i + 1 })),
    }));
  });

  protected readonly band = computed(() => {
    const { ghost, lifted } = this.#marks();
    const fresh = this.fresh();
    const placed = placeInLanes(this.#shown(), this.days(), 'band');
    return {
      lanes: Math.max(laneCount(placed), 1),
      bars: placed.map((one) => ({
        ...one,
        key: one.event.id,
        ghost: one.event.id === ghost,
        lifted: one.event.id === lifted,
        fresh: one.event.id === fresh,
      })),
    };
  });

  protected readonly columns = computed(() => {
    const { ghost, lifted } = this.#marks();
    const fresh = this.fresh();
    const shown = this.#shown();
    const today = this.today();
    const now = this.now();
    return this.days().map((day) => ({
      day,
      now: day === today ? minuteOfDay(now) : null,
      events: placeInDay(shown, day).map((one) => ({
        ...one,
        key: one.event.id,
        // A short block has room for one line: the title alone.
        lines: one.length < 45 ? 1 : Math.max(1, Math.floor((one.length / 60) * 2.4) - 1),
        ghost: one.event.id === ghost,
        lifted: one.event.id === lifted,
        fresh: one.event.id === fresh,
      })),
    }));
  });

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

  /** A press on an empty hour: room for a new event begins there. */
  protected pressHours(event: PointerEvent): void {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    const { day, minute } = this.#at(event);
    // Its slot: the half hour pressed, as Google's.
    const anchor = Math.floor(minute / 30) * 30;
    const start = this.#moment(day, anchor);
    this.#begin(event, {
      kind: 'create',
      anchor: Math.floor(minute / SNAP) * SNAP,
      day,
      preview: editAsEvent(draftAt(start, { minutes: DEFAULT_EVENT_MINUTES })),
    });
  }

  /** A press on an event: a press opens it, a drag moves it. */
  protected pressEvent(event: PointerEvent, shown: CalendarEvent): void {
    if (event.button !== 0 || shown.id === DRAFT_ID || event.pointerType === 'touch') return;
    const stored = this.events().find((one) => one.id === shown.id);
    if (!stored) return;
    const { day, minute } = this.#at(event);
    const start = eventSpan(stored).start;
    const startMinute = (start.toMillis() - parseDay(this.days()[day])!.toMillis()) / 60_000;
    this.#begin(event, {
      kind: 'move',
      anchor: minute - startMinute,
      day,
      preview: stored,
      element: event.currentTarget as Element,
    });
  }

  /** A press on an event's foot: a drag stretches it. */
  protected pressFoot(event: PointerEvent, shown: CalendarEvent): void {
    if (event.button !== 0 || shown.id === DRAFT_ID) return;
    const stored = this.events().find((one) => one.id === shown.id);
    if (!stored) return;
    event.stopPropagation();
    const { day } = this.#at(event);
    this.#begin(event, { kind: 'resize', anchor: 0, day, preview: stored });
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
    if (!drag || drag.pointer !== event.pointerId) return;
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

  #previewAt(drag: Drag, day: number, minute: number): CalendarEvent {
    const snapped = snapMinutes(minute, SNAP);
    if (drag.kind === 'create') {
      // From where it was pressed to where it is, either way; a step at
      // the least.
      const from = Math.min(drag.anchor, snapped);
      const to = Math.max(drag.anchor + SNAP, snapped);
      const start = this.#moment(drag.day, from);
      return {
        ...drag.preview,
        start: isoMoment(start),
        end: isoMoment(start.plus({ minutes: to - from })),
      };
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
    if (drag.kind === 'create') {
      // A press marks the slot's hour; a drag, the room it went across.
      const { id: _, ...draft } = drag.preview;
      this.create.emit({ draft, rect: this.#slotBox(drag.preview) });
      return;
    }
    // A press opens the event here: the grid held the pointer, so the
    // click it ends with lands on the grid — and is spent, as a drag's is.
    this.#swallowClick = true;
    setTimeout(() => (this.#swallowClick = false));
    if (!drag.moved) {
      if (drag.element) this.open.emit({ id: drag.preview.id, rect: boxOf(drag.element) });
      return;
    }
    const { start, end } = drag.preview;
    const stored = this.events().find((one) => one.id === drag.preview.id);
    if (stored && (stored.start !== start || stored.end !== end)) this.change.emit(drag.preview);
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
    this.open.emit({ id: shown.id, rect: boxOf(event.currentTarget as Element) });
  }

  /** A press on the band: an all-day event that day. */
  protected pressBand(event: MouseEvent): void {
    if (event.target !== event.currentTarget) return;
    const band = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const count = this.days().length;
    const rtl = getComputedStyle(event.currentTarget as HTMLElement).direction === 'rtl';
    const x = rtl ? band.right - event.clientX : event.clientX - band.left;
    const day = Math.min(count - 1, Math.max(0, Math.floor((x / band.width) * count)));
    const width = band.width / count;
    this.create.emit({
      draft: draftAt(parseDay(this.days()[day])!, { allDay: true }),
      rect: {
        left: rtl ? band.right - (day + 1) * width : band.left + day * width,
        top: band.top,
        width,
        height: band.height,
      },
    });
  }

  /** Where an event in the hours stands on screen — for a new one's card,
      before it is drawn. */
  #slotBox(event: CalendarEvent): AnchorRect {
    const box = this.columnsEl().nativeElement.getBoundingClientRect();
    const count = this.days().length;
    const { start, end } = eventSpan(event);
    const day = this.days().indexOf(isoDay(start));
    const width = box.width / count;
    const rtl = getComputedStyle(this.columnsEl().nativeElement).direction === 'rtl';
    const top = box.top + (minuteOfDay(start) / 60) * HOUR_HEIGHT;
    const height = (end.diff(start, 'minutes').minutes / 60) * HOUR_HEIGHT;
    return {
      left: rtl ? box.right - (day + 1) * width : box.left + Math.max(day, 0) * width,
      top,
      width,
      height,
    };
  }
}
