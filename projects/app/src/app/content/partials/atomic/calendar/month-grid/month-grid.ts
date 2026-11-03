import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DateTime } from 'luxon';

import { TranslatePipe } from '@ngx-translate/core';

import {
  IsoDay,
  daysBetween,
  isoDay,
  parseDay,
  startOfWeek,
} from '../../../../../core/calendar/calendar-dates';
import {
  CalendarEvent,
  DRAFT_ID,
  EVENT_COLOR_VALUES,
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
import {
  DRAG_THRESHOLD,
  DoublePress,
  EdgeTurns,
  TURN_ZONE,
  GridCreate,
  GridOpen,
  GridWindow,
  boxOf,
  GridSlot,
  headOf,
} from '../calendar-grid';

/** A row's sizes, px: the date's line, and a lane (22 + 2 apart). */
const DATE_LINE = 28;
const LANE = 24;

/** How many weeks a screen of the month holds — Notion's, near enough
    (5.9 of its rows fill its view): a month and the edge of the next. */
const MONTH_ROWS = 6;
/** A row's least height, px: a date's line and one lane. */
const MIN_ROW = DATE_LINE + LANE + 4;
/** Rows drawn past the view's either end, so a scroll never shows a gap
    before they are. */
const OVERSCAN = 2;
/** The weeks the strip runs over: from the first of 1990 to the first of
    2070 — far past where anyone scrolls, under any browser's height. */
const FIRST_DAY = DateTime.local(1990, 1, 1);
const LAST_DAY = DateTime.local(2070, 1, 1);

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
 * The month, Notion Calendar's: one strip of weeks, scrolled — not a page
 * per month. Every week is a row at its place in the strip (its index ×
 * the row's height, by the calendar, never measured), and only the rows in
 * view are drawn. A screen holds six (a custom run of weeks: its length);
 * the wheel scrolls week by week and stops at every month's first week.
 * The month most in view is the month (`rangeChange`, the page's path
 * follows); a day of another is faint. The page's own moves — the arrows,
 * Today, a day in the mini month — set it straight there.
 *
 * Every day is a cell of its date and its events — bars for the ones
 * across days and all day, a dot, a time and a title for a timed one — as
 * many lanes as the row has room for, the rest behind "+2 more" (which
 * opens the day); today's date a filled circle.
 *
 * Double-press a day and it holds a new all-day event (`create`) — or drag
 * across days and weeks, and every cell between is washed, Notion's; the
 * card opens by its first day. A press alone makes nothing (`dismiss`).
 * Press its date and that day opens alone (`dayOpen`); press an event and
 * it opens (`open`); carry one to another day and it moves there, its time
 * kept (`change`). A drag held past the weeks' top or at their foot
 * scrolls the strip to the month before or after (`EdgeTurns`: at once,
 * and on while held), what is dragged running on with it — a day is the
 * strip's arithmetic under the pointer, so nothing is ever handed over.
 */
@Component({
  selector: 'calendar-month-grid',
  imports: [EventChip, TranslatePipe],
  templateUrl: './month-grid.html',
  styleUrl: './month-grid.scss',
  host: {
    '[style.--cols]': 'weeks()[0]?.length ?? 7',
    '[style.--month-grid-mark]': 'markColor()',
    '[class.month-grid--dragging]': 'dragging()',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'release($event)',
    '(pointercancel)': 'cancel()',
  },
})
export class MonthGrid {
  readonly #formats = inject(CalendarFormat).formats;
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #destroyRef = inject(DestroyRef);
  readonly #injector = inject(Injector);

  /** The page's weeks: where the strip stands (their first), and which
      days a row holds (weekends hidden: five). */
  readonly weeks = input.required<readonly (readonly IsoDay[])[]>();
  /** A day of the month shown — the strip's month view. None for a run of
      weeks (Google's custom weeks): every day is as much its own. */
  readonly month = input<IsoDay | null>(null);
  readonly events = input.required<readonly CalendarEvent[]>();
  readonly draft = input<EventEdit | null>(null);
  /** The event pressed last — selected, its card open or not. */
  readonly selected = input<string | null>(null);
  /** The event whose chip is `current` (`aria-current`): the stored one
      being written, else the one selected. Never the mark — a new event's
      room, drawn as itself. */
  protected readonly currentId = computed(() => this.draft()?.id ?? this.selected());
  readonly today = input.required<IsoDay>();
  readonly untitled = input('');

  readonly create = output<GridCreate>();
  readonly open = output<GridOpen>();
  readonly change = output<CalendarEvent>();
  readonly dayOpen = output<IsoDay>();
  /** A day's empty room pressed once, without a drag: nothing made — what
      is open closes. */
  readonly dismiss = output<void>();
  /** Scrolled to another month (its first day) — or, a run of weeks, to
      another first week (its first day): where the page now is. */
  readonly rangeChange = output<IsoDay>();
  /** The days drawn now, first to last — what the feed is asked for. */
  readonly windowChange = output<GridWindow>();

  readonly #presses = new DoublePress();
  readonly #turns = new EdgeTurns();
  private readonly scrollerEl = viewChild.required<ElementRef<HTMLElement>>('weeksBox');
  /** Where the dragging pointer is, and the frame that watches it at the
      edges (`#edgeStep`). */
  #pointerAt: { clientX: number; clientY: number } | null = null;
  #edgeFrame = 0;

  readonly #drag = signal<Drag | null>(null);
  protected readonly dragging = computed(() => !!this.#drag()?.moved);
  #swallowClick = false;

  // ─── The strip ──────────────────────────────────────────────────────

  /** The scroller's height and scroll, px. */
  readonly #height = signal(0);
  readonly #scrollTop = signal(0);

  /** A row's height: a screen's share, `MONTH_ROWS` of them (a run of
      weeks: as many as it has). */
  protected readonly rowHeight = computed(() => {
    const rows = this.month() ? MONTH_ROWS : this.weeks().length;
    return Math.max(MIN_ROW, this.#height() / rows);
  });

  /** How many lanes a row has room for, under its date's line. */
  readonly #lanes = computed(() =>
    Math.max(1, Math.floor((this.rowHeight() - DATE_LINE - 4) / LANE)),
  );

  /** Row 0's first day: the week holding `FIRST_DAY`, by the language's
      first weekday. */
  readonly #origin = computed(() => startOfWeek(FIRST_DAY, this.#formats().weekStart));
  /** How many rows the strip has. */
  protected readonly rowCount = computed(() =>
    Math.ceil(daysBetween(this.#origin(), LAST_DAY) / 7),
  );
  /** Which days of a week a row holds — the page's first week's, as days
      after its week's first: all seven, or five without the weekends. */
  readonly #offsets = computed(() => {
    const first = this.weeks()[0];
    const start = startOfWeek(parseDay(first[0])!, this.#formats().weekStart);
    return first.map((day) => daysBetween(start, parseDay(day)!));
  });

  /** A row's days. */
  #rowDays(row: number): IsoDay[] {
    const start = this.#origin().plus({ weeks: row });
    return this.#offsets().map((offset) => isoDay(start.plus({ days: offset })));
  }

  /** The row a day is in. */
  #rowOf(day: IsoDay): number {
    const start = startOfWeek(parseDay(day)!, this.#formats().weekStart);
    return Math.round(daysBetween(this.#origin(), start) / 7);
  }

  /** The row at the view's top, whole or not. */
  readonly #topRow = computed(() => Math.floor(this.#scrollTop() / this.rowHeight()));

  /** Where the page stands: the first of its month, or its first week's
      first day. */
  readonly #pageAnchor = computed(() => {
    const month = this.month();
    return month ? isoDay(parseDay(month)!.startOf('month')) : this.weeks()[0][0];
  });

  /** The month most in view (the middle row's middle day's): its days are
      the month's, the others faint. None for a run of weeks. */
  readonly #viewMonth = computed(() => {
    if (!this.month()) return null;
    const middle = Math.floor((this.#scrollTop() + this.#height() / 2) / this.rowHeight());
    const days = this.#rowDays(middle);
    // A day's string, not a date: equal while the month is, so the rows
    // are laid out again only when it changes.
    return isoDay(parseDay(days[Math.floor(days.length / 2)])!.startOf('month'));
  });

  /** Where the strip is: the first of the month in view, or the first day
      of the week at the top (rounded to the nearest). */
  readonly #viewAnchor = computed(() => {
    const month = this.#viewMonth();
    if (month) return month;
    return this.#rowDays(Math.round(this.#scrollTop() / this.rowHeight()))[0];
  });
  /** The anchor the strip last stood on, set or scrolled to — the page's
      own coming back is no move. */
  #anchor: IsoDay | null = null;
  /** The row height it was laid out at: a new one lays it out again. */
  #laidAt = 0;
  /** Where an edge's turns are taking the strip, till it gets there; and
      the fallback that puts snapping back. */
  #turningTo: IsoDay | null = null;
  #snapBack: ReturnType<typeof setTimeout> | undefined;

  /** The new event's room, marked out — Notion's month selection: not a
      bar among the events (where it could fall behind "+2 more"), the
      days themselves, every cell it covers washed in its colour. */
  readonly #mark = computed(() => {
    const mark = this.#shown().find((event) => event.id === DRAFT_ID);
    if (!mark) return null;
    const { start, end } = eventSpan(mark);
    return {
      first: isoDay(start),
      last: isoDay(DateTime.max(start, end.minus({ minutes: 1 }))),
      color: EVENT_COLOR_VALUES[mark.color],
    };
  });
  protected readonly markColor = computed(() => this.#mark()?.color ?? null);

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

  /** The rows drawn — those in view and `OVERSCAN` either side — by
      index. */
  readonly #drawn = computed(
    () => {
      const top = this.#topRow();
      return {
        from: Math.max(0, top - OVERSCAN),
        to: Math.min(
          this.rowCount(),
          top + Math.ceil(this.#height() / this.rowHeight()) + 1 + OVERSCAN,
        ),
      };
    },
    { equal: (a, b) => a.from === b.from && a.to === b.to },
  );

  /** The rows drawn, laid out. */
  protected readonly rows = computed(() => {
    const formats = this.#formats();
    const month = parseDay(this.#viewMonth());
    const today = this.today();
    const shown = this.#shown().filter((event) => event.id !== DRAFT_ID);
    const mark = this.#mark();
    const capacity = this.#lanes();
    const height = this.rowHeight();
    const drag = this.#drag();
    const lifted = drag?.moved ? drag.preview.id : null;
    const { from, to } = this.#drawn();

    return Array.from({ length: Math.max(0, to - from) }, (_, i) => {
      const index = from + i;
      const week = this.#rowDays(index);
      const placed = placeInLanes(shown, week, 'all');
      const overflowing = placed.some((one) => one.lane >= capacity);
      // With more than fits, the last lane says how many more.
      const visible = overflowing ? Math.max(capacity - 1, 0) : capacity;
      const hidden = week.map(() => 0);
      for (const one of placed) {
        if (one.lane < visible) continue;
        for (let day = one.from; day < one.from + one.span; day++) hidden[day]++;
      }
      const dates = week.map((day) => parseDay(day)!);
      return {
        key: index,
        first: week[0],
        top: index * height,
        // A month begins in it: the wheel stops here, whatever its speed.
        monthStart: dates.some((date) => date.day === 1),
        days: week.map((day, column) => {
          const date = dates[column];
          return {
            day,
            column: column + 1,
            number: date.day === 1 ? formats.shortDay(date) : String(date.day),
            label: formats.longDay(date),
            outside: !!month && !date.hasSame(month, 'month'),
            weekend: date.weekday > 5,
            today: day === today,
            marked: !!mark && day >= mark.first && day <= mark.last,
            more: hidden[column],
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
            lifted: one.event.id === lifted,
          })),
      };
    });
  });

  constructor() {
    this.#destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.#edgeFrame);
      clearTimeout(this.#snapBack);
    });

    // The scroller's height, as it changes: the rows share it.
    afterNextRender({
      read: () => {
        const scroller = this.scrollerEl().nativeElement;
        const observer = new ResizeObserver(() => this.#height.set(scroller.clientHeight));
        observer.observe(scroller);
        this.#destroyRef.onDestroy(() => observer.disconnect());
      },
    });

    // The page moved (the arrows, Today, a day in the mini month), or the
    // rows took a new height: straight there, its first week at the top —
    // not when the page only follows where the strip already is.
    afterRenderEffect({
      write: () => {
        const anchor = this.#pageAnchor();
        const height = this.rowHeight();
        if (!this.#height()) return;
        untracked(() => {
          if (anchor === this.#anchor && height === this.#laidAt) return;
          const to = anchor !== this.#anchor ? anchor : this.#anchor!;
          this.#anchor = to;
          this.#laidAt = height;
          this.#turningTo = null;
          const scroller = this.scrollerEl().nativeElement;
          const top = this.#rowOf(to) * height;
          // No snapping across the jump: only the rows about the old place
          // are drawn yet, and the browser would snap back to the nearest
          // of them. On again once the rows here are drawn.
          scroller.style.scrollSnapType = 'none';
          scroller.scrollTop = top;
          this.#scrollTop.set(top);
          afterNextRender(() => (scroller.style.scrollSnapType = ''), {
            injector: this.#injector,
          });
        });
      },
    });

    // The rows drawn: the feed is asked for their days.
    effect(() => {
      const { from, to } = this.#drawn();
      if (to <= from) return;
      untracked(() =>
        this.windowChange.emit({ from: this.#rowDays(from)[0], to: this.#rowDays(to - 1).at(-1)! }),
      );
    });

    // Scrolled somewhere else: the page follows.
    effect(() => {
      const anchor = this.#viewAnchor();
      untracked(() => {
        if (!this.#height() || !this.#anchor || anchor === this.#anchor) return;
        this.#anchor = anchor;
        this.rangeChange.emit(anchor);
      });
    });
  }

  protected scrolled(): void {
    this.#scrollTop.set(this.scrollerEl().nativeElement.scrollTop);
    // The wheel turned under a drag: what is dragged follows the pointer.
    this.#follow();
  }

  /** The scroll's end: an edge's turns arrived — snapping on again. */
  protected scrollEnded(): void {
    this.#turningTo = null;
    clearTimeout(this.#snapBack);
    this.scrollerEl().nativeElement.style.scrollSnapType = '';
  }

  protected dateOpen(day: IsoDay): void {
    this.dayOpen.emit(day);
  }

  // ─── Pointer ────────────────────────────────────────────────────────

  /** A press on a day's empty room: a new all-day event's mark begins
      there — that day, or every day the drag goes over. */
  protected pressDay(event: PointerEvent, day: IsoDay): void {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    this.#turns.reset();
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
    if (event.button !== 0) return;
    // A holiday (read-only) opens on its click; it never moves.
    if (event.pointerType === 'touch' || shown.readonly) return;
    const stored = this.events().find((one) => one.id === shown.id);
    if (!stored) return;
    // The day it was picked up on: the one under the pointer.
    const under = this.#dayAt(event) ?? day;
    this.#host.setPointerCapture(event.pointerId);
    this.#turns.reset();
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

  /** The strip's room on screen — the scroller's, its scrollbar left out:
      it holds still whatever scrolls in it. */
  #box(): { left: number; top: number; width: number; height: number; rtl: boolean } {
    const scroller = this.scrollerEl().nativeElement;
    const { left, top } = scroller.getBoundingClientRect();
    return {
      left: left + scroller.clientLeft,
      top: top + scroller.clientTop,
      width: scroller.clientWidth,
      height: scroller.clientHeight,
      rtl: getComputedStyle(scroller).direction === 'rtl',
    };
  }

  /** The day under a point: the strip's arithmetic — its row by the scroll
      and the rows' height, its column by the width — never what is drawn
      there. None outside the strip's room. */
  #dayAt(at: { clientX: number; clientY: number }): IsoDay | null {
    const box = this.#box();
    const x = at.clientX - box.left;
    const y = at.clientY - box.top;
    if (x < 0 || x >= box.width || y < 0 || y >= box.height) return null;
    const columns = this.#offsets().length;
    const across = Math.min(columns - 1, Math.floor((x / box.width) * columns));
    const scrollTop = this.scrollerEl().nativeElement.scrollTop;
    // A pixel's grace: a row's top is a fraction (its index × the row's
    // height), the scroll a whole number just under it — the row above.
    const row = Math.floor((y + scrollTop + 1) / this.rowHeight());
    if (row < 0 || row >= this.rowCount()) return null;
    return this.#rowDays(row)[box.rtl ? columns - 1 - across : across];
  }

  /** The day nearest a pointer — under it, or the edge's under a pointer
      gone past the strip's room. */
  #nearestDay(at: { clientX: number; clientY: number }): IsoDay | null {
    const box = this.#box();
    const clamp = (value: number, from: number, size: number) =>
      Math.min(from + size - 1, Math.max(from, value));
    return this.#dayAt({
      clientX: clamp(at.clientX, box.left, box.width),
      clientY: clamp(at.clientY, box.top, box.height),
    });
  }

  /** The drag as it would drop on a day. */
  #previewOn(drag: Drag, day: IsoDay): CalendarEvent {
    if (drag.kind === 'days') {
      const [from, to] = [drag.from, day].sort();
      const days = daysBetween(parseDay(from)!, parseDay(to)!) + 1;
      return { ...drag.stored, ...draftAt(parseDay(from)!, { allDay: true, days }) };
    }
    const shift = daysBetween(parseDay(drag.from)!, parseDay(day)!);
    return movedTo(drag.stored, eventSpan(drag.stored).start.plus({ days: shift }));
  }

  /** What is dragged, to the day nearest the pointer — after the strip
      moved under a pointer that did not. */
  #follow(): void {
    const drag = this.#drag();
    const at = this.#pointerAt;
    if (!drag?.moved || !at) return;
    const day = this.#nearestDay(at);
    if (!day) return;
    const preview = this.#previewOn(drag, day);
    if (preview.start !== drag.preview.start || preview.end !== drag.preview.end) {
      this.#drag.set({ ...drag, preview });
    }
  }

  /** A turn at an edge: the strip scrolls to the month before or after —
      or a run of weeks, by its length — from where the last turn was
      taking it, if it is not there yet. */
  #turn(direction: -1 | 1): void {
    const from = this.#turningTo ?? this.#viewAnchor();
    const month = this.month();
    const to = month
      ? isoDay(parseDay(from)!.startOf('month').plus({ months: direction }))
      : isoDay(parseDay(from)!.plus({ weeks: this.weeks().length * direction }));
    this.#turningTo = to;
    const scroller = this.scrollerEl().nativeElement;
    // No snapping on the way: a month up, its first week is not drawn yet
    // (only the rows about the view are), and the browser would stop at
    // the nearest row that is. On again at the scroll's end — or a beat
    // after, where a browser never says it ended.
    scroller.style.scrollSnapType = 'none';
    scroller.scrollTo({ top: this.#rowOf(to) * this.rowHeight(), behavior: 'smooth' });
    clearTimeout(this.#snapBack);
    this.#snapBack = setTimeout(() => this.scrollEnded(), 1500);
  }

  /** A frame of a drag past the weeks' top (onto the weekdays) or at
      their foot, or past it: the strip turns (`EdgeTurns`), and what is
      dragged runs on to the day now nearest the pointer. Stops once the
      pointer leaves the edges, or the drag ends. The top has no room
      inside it: the first week's bars stand right under its edge, and are
      carried along it. */
  #edgeStep(time: number): void {
    this.#edgeFrame = 0;
    const drag = this.#drag();
    const at = this.#pointerAt;
    if (!drag?.moved || !at) return this.#turns.reset();
    const box = this.#box();
    const bottom = box.top + box.height;
    const side = at.clientY < box.top ? -1 : at.clientY > bottom - TURN_ZONE ? 1 : 0;
    const turn = this.#turns.at(side, time);
    if (turn) this.#turn(turn);
    if (!side) return;
    this.#follow();
    this.#edgeFrame = requestAnimationFrame((next) => this.#edgeStep(next));
  }

  protected move(event: PointerEvent): void {
    const drag = this.#drag();
    if (!drag || drag.pointer !== event.pointerId) return;
    const moved =
      drag.moved || Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > DRAG_THRESHOLD;
    if (!moved) return;
    if (event.pointerType === 'touch') return this.#drag.set(null);
    this.#pointerAt = { clientX: event.clientX, clientY: event.clientY };
    if (!this.#edgeFrame) {
      this.#edgeFrame = requestAnimationFrame((time) => this.#edgeStep(time));
    }
    const day = this.#dayAt(event);
    if (!day) return this.#drag.set({ ...drag, moved });
    this.#drag.set({ ...drag, moved, preview: this.#previewOn(drag, day) });
  }

  protected release(event: PointerEvent): void {
    const drag = this.#drag();
    if (!drag || drag.pointer !== event.pointerId) return;
    this.#drag.set(null);
    this.#pointerAt = null;
    // A press opens the event here: the grid held the pointer, so the
    // click it ends with lands on the grid — and is spent, as a drag's is.
    this.#swallowClick = true;
    setTimeout(() => (this.#swallowClick = false));
    if (drag.kind === 'days') {
      // Made by a drag let go, or a double press; a press alone only
      // closes what is open.
      if (!drag.moved && !this.#presses.second(drag.from, event.timeStamp)) {
        this.dismiss.emit();
        return;
      }
      // The card opens by the mark's first day (or where it was pressed,
      // its first day scrolled away).
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
    this.#pointerAt = null;
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
