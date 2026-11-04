import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DateTime } from 'luxon';

import { AnchorRect } from '@h-k-dev/angular-email-editor/anchor';
import { TranslatePipe } from '@ngx-translate/core';

import {
  DAY_MINUTES,
  IsoDay,
  atMinute,
  daysBetween,
  isoDay,
  isoMoment,
  minuteOfDay,
  minutesInto,
  parseDay,
  snapMinutes,
  startOfWeek,
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
import {
  DRAG_THRESHOLD,
  DoublePress,
  EdgeTurns,
  TURN_ZONE,
  GridCreate,
  pressedEmptyOrMark,
  GridOpen,
  GridSlot,
  GridMarquee,
  GridMarqueePoint,
  GridWindow,
  boxOf,
  headOf,
} from '../calendar-grid';

/** An hour's height, px — the one size the grid's minutes are multiplied
    by (set on the host as `--hour`). */
export const HOUR_HEIGHT = 48;

/** The step a press and a drag snap to, minutes — Notion's quarter hour. */
const SNAP = 15;

/** How near the hours' top or foot a drag starts them scrolling, px. */
const EDGE = 48;
/** How fast they scroll — a pointer on the edge or past it — px a second:
    thirty hours. Just inside it, a quarter of that (`EDGE_FLOOR`), rising
    to it across the `EDGE`. */
const EDGE_SPEED = 30 * HOUR_HEIGHT;
const EDGE_FLOOR = 0.25;

/** The days the strip runs over: twenty years either side of 2026 — far
    past where anyone scrolls, and under any browser's widest page with a
    day a screen wide. */
const FIRST_DAY = DateTime.local(2006, 1, 1);
const LAST_DAY = DateTime.local(2046, 1, 1);

/** Whether the browser says when a scroll ends (`scrollend`). */
const SCROLL_END = typeof window !== 'undefined' && 'onscrollend' in window;

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
      from the event's start to where it was picked up. days: unused. */
  anchor: number;
  /** The moment pressed (its day at `anchor`): a moment, not a column —
      the strip scrolls under a drag. */
  pressed: DateTime;
  /** The event's chip, for a press: the grid holds the pointer, so the
      click lands on the grid, never on it. */
  element?: Element;
}

/**
 * A day's or a week's hours, Notion Calendar's: one strip of days, scrolled
 * — not a page per week. Every day is a column at its place in the strip
 * (its index × the column's width, by the calendar, never measured), and
 * only the days in view and an interval either side are drawn. A screen
 * holds the page's days (`days`: a week, its weekdays, a day, a custom
 * run); the strip sideways snaps to days and, a week a screen, stops at
 * every week. The interval most in view is the page's (`rangeChange`, its
 * path follows); the page's own moves — the arrows, Today, a day in the
 * mini month — set it straight there. The days drawn are asked of the feed
 * (`windowChange`).
 *
 * The days' heads on top and the band of all-day (and overnight) events
 * under them hold still over the hours as they scroll down; the hours'
 * gutter holds still as the days scroll by. Each day is a column its timed
 * events stand in, side by side where they overlap. A line marks the
 * quarter hour under the pointer, one in the theme's primary now.
 *
 * Press an hour and drag, and the time is marked out as you go — Notion's
 * selection, the colour at an eighth, its times in it; drag sideways and
 * it runs on across the days between, shown in each (and in the band,
 * whole days); let go and it is a new event's room (`create`), with the
 * box to open its card beside — so is a double press, an hour from its
 * quarter; a press alone makes nothing (`dismiss`). The mark stays while
 * the card is open: its foot stretches it (`draftChange`), a press in it
 * marks out anew. Press an event and it opens (`open`); drag it — across
 * days too — and it moves, drag its foot and it stretches (`change`).
 * Everything in quarter hours, where the pointer is, at once. Any drag
 * held at the hours' top or foot scrolls them on, the further out the
 * faster; held at the days' start or end, the strip slides an interval
 * on (`EdgeTurns`: at once, and on while held) — the drag runs on with it.
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
    '[style.--days]': 'shownDays().length',
    '[class.time-grid--dragging]': 'dragging()',
    '(document:keydown.escape)': 'escape($event)',
  },
})
export class TimeGrid {
  readonly #formats = inject(CalendarFormat).formats;
  readonly #destroyRef = inject(DestroyRef);

  /** The page's days: where the strip stands (their first), and how many a
      screen holds. */
  readonly days = input.required<readonly IsoDay[]>();
  /** Whether the strip holds Saturdays and Sundays — off, its days are
      the weekdays alone. */
  readonly weekends = input(true);
  readonly events = input.required<readonly CalendarEvent[]>();
  /** The event being written, shown where it will be. */
  readonly draft = input<EventEdit | null>(null);
  /** The events selected — the one pressed last, or a marquee's. */
  readonly selected = input<readonly string[]>([]);
  /** The events whose chips are `current` (`aria-current`), by id: the
      stored one being written, else those selected — while a marquee is
      drawn, those it covers. Never the mark — a new event's room, drawn as
      itself. */
  protected readonly currentIds = computed<Readonly<Record<string, true>>>(() => {
    const marquee = this.#marquee();
    const draft = this.draft()?.id;
    const ids = marquee?.moved ? this.#marqueeHits() : draft ? [draft] : this.selected();
    return Object.fromEntries(ids.map((id) => [id, true as const]));
  });
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
  /** Empty room pressed once, without a drag: nothing made — what is open
      closes. */
  readonly dismiss = output<void>();
  /** A marquee let go: the events it covered, selected. */
  readonly selectMany = output<readonly string[]>();
  /** An event pressed with Shift, not dragged: in the selection, or out. */
  readonly selectToggle = output<string>();
  /** Scrolled to another interval: its first day — where the page now is. */
  readonly rangeChange = output<IsoDay>();
  /** The days drawn now, first to last — what the feed is asked for. */
  readonly windowChange = output<GridWindow>();

  protected readonly hourHeight = HOUR_HEIGHT;
  readonly #presses = new DoublePress();

  protected readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  protected readonly columnsEl = viewChild.required<ElementRef<HTMLElement>>('dayColumns');
  protected readonly bandEl = viewChild.required<ElementRef<HTMLElement>>('bandDays');
  private readonly topEl = viewChild.required<ElementRef<HTMLElement>>('top');
  private readonly gutterEl = viewChild.required<ElementRef<HTMLElement>>('gutter');

  readonly #drag = signal<Drag | null>(null);
  /** A marquee over the hours (`GridMarquee`: px across from the strip's
      first day, down from midnight). */
  readonly #marquee = signal<GridMarquee | null>(null);
  protected readonly dragging = computed(() => !!this.#drag()?.moved || !!this.#marquee()?.moved);
  /** Where the dragging pointer is: held at the hours' top or foot, they
      scroll on under it; at the days' start or end, the strip slides
      (`#edgeStep`). */
  #pointerAt: { clientX: number; clientY: number } | null = null;
  /** When a drag at the days' start or end slides the strip. */
  readonly #turns = new EdgeTurns();
  /** The edge scroll's next frame, its last frame's time, and the part of
      a pixel it still owes. */
  #edgeFrame = 0;
  #edgeTime = 0;
  #edgeCarry = 0;
  /** A drag or a press just ended: the click that follows is spent. */
  #swallowClick = false;

  /** The quarter hour under a mouse, while nothing is dragged: its day,
      among those drawn, and minute. */
  readonly #hover = signal<{ day: number; minute: number } | null>(null);

  // ─── The strip ──────────────────────────────────────────────────────

  /** The days' room across (the scroller's, the gutter and scrollbar left
      out), and the scroll sideways, px. */
  readonly #width = signal(0);
  readonly #scrollLeft = signal(0);

  /** How many days a screen holds: the page's. */
  readonly #perScreen = computed(() => Math.max(1, this.days().length));
  /** A day's column, px — 0 before the strip is measured (and where
      nothing is laid out: the page's days alone are drawn then). */
  protected readonly columnWidth = computed(() => this.#width() / this.#perScreen());

  /** Index 0's week: the week holding `FIRST_DAY`, by the language's
      first weekday. */
  readonly #origin = computed(() => startOfWeek(FIRST_DAY, this.#formats().weekStart));
  /** Which days of a week the strip holds, as days after its first: all
      seven, or the five weekdays. */
  readonly #offsets = computed(() => {
    const origin = this.#origin();
    return [0, 1, 2, 3, 4, 5, 6].filter(
      (offset) => this.weekends() || origin.plus({ days: offset }).weekday <= 5,
    );
  });
  /** How many days the strip has. */
  protected readonly dayCount = computed(
    () => Math.ceil(daysBetween(this.#origin(), LAST_DAY) / 7) * this.#offsets().length,
  );

  /** The strip's day at an index. */
  #dayOf(index: number): IsoDay {
    const offsets = this.#offsets();
    const week = Math.floor(index / offsets.length);
    return isoDay(this.#origin().plus({ weeks: week, days: offsets[index % offsets.length] }));
  }

  /** A day's index — a day the strip does not hold (a weekend, hidden):
      the next it does. */
  #indexOf(day: IsoDay): number {
    const date = parseDay(day)!;
    const offsets = this.#offsets();
    const week = Math.floor(daysBetween(this.#origin(), date) / 7);
    const offset = daysBetween(this.#origin().plus({ weeks: week }), date);
    const at = offsets.findIndex((one) => one >= offset);
    return at < 0 ? (week + 1) * offsets.length : week * offsets.length + at;
  }

  /** Whether a screen is a week: the strip's place is counted in weeks. */
  readonly #weekScreens = computed(
    () =>
      this.#perScreen() === this.#offsets().length && this.#pageIndex() % this.#perScreen() === 0,
  );

  /** Where the page stands: its first day's index. */
  readonly #pageIndex = computed(() => this.#indexOf(this.days()[0]));

  /** Where the strip stands: the interval most in view — its first day's
      index (a week a screen: the week's). */
  readonly #viewIndex = computed(() => {
    const width = this.columnWidth();
    if (!width) return this.#pageIndex();
    const step = this.#weekScreens() ? this.#perScreen() : 1;
    return Math.round(this.#scrollLeft() / (width * step)) * step;
  });

  /** The days drawn: those in view and an interval either side, by index.
      Unmeasured, the page's days alone. */
  protected readonly window = computed(
    () => {
      const width = this.columnWidth();
      const perScreen = this.#perScreen();
      if (!width) return { from: this.#pageIndex(), to: this.#pageIndex() + perScreen };
      const first = Math.floor((this.#scrollLeft() + 1) / width);
      const buffer = Math.max(perScreen, 2);
      return {
        from: Math.max(0, first - buffer),
        to: Math.min(this.dayCount(), first + perScreen + 1 + buffer),
      };
    },
    { equal: (a, b) => a.from === b.from && a.to === b.to },
  );

  /** The strip's width, and the drawn days' place and width in it, px —
      none before it is measured (the days fill the room then). */
  protected readonly stripWidth = computed(() => this.dayCount() * this.columnWidth() || null);
  protected readonly windowLeft = computed(() => this.window().from * this.columnWidth() || null);
  protected readonly windowWidth = computed(() => {
    const { from, to } = this.window();
    return (to - from) * this.columnWidth() || null;
  });

  /** The days drawn, as days. */
  protected readonly shownDays = computed(() => {
    const { from, to } = this.window();
    return Array.from({ length: to - from }, (_, i) => this.#dayOf(from + i));
  });

  /** The index the strip last stood on, set or scrolled to — the page's
      own coming back is no move — and the column width it was laid out
      at: a new one lays it out again. */
  #anchor: number | null = null;
  #laidAt = 0;
  /** Where an edge's slides are taking the strip, till it gets there; and,
      where a browser never says a scroll ended, the beat after its last
      move that stands for it. */
  #turningTo: number | null = null;
  #settleLater: ReturnType<typeof setTimeout> | undefined;

  // ─── What it shows ──────────────────────────────────────────────────

  /** What the grid lays out: the stored events, the one being written in
      place of its stored self, the one being dragged as it would drop. */
  readonly #shown = computed(() => {
    const drag = this.#drag();
    const draft = this.draft();
    const replaced = drag?.moved ? drag.preview : draft ? editAsEvent(draft) : null;
    const events = this.events().filter((event) => event.id !== replaced?.id);
    return replaced ? [...events, replaced] : events;
  });

  /** A timed event moved or stretched in the hours: it stays in them for
      the whole drag, shown in each day it runs over — the mark's way —
      though run past midnight it belongs to the band; dropped, it goes
      there. */
  readonly #held = computed(() => {
    const drag = this.#drag();
    if (!drag || (drag.kind !== 'move' && drag.kind !== 'resize')) return null;
    return drag.preview.id === DRAFT_ID || drag.preview.allDay ? null : drag.preview.id;
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
    return this.shownDays().map((day) => {
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
    const now = this.shownDays().includes(this.today()) ? minuteOfDay(this.now()) : null;
    return Array.from({ length: 23 }, (_, i) => ({
      hour: i + 1,
      label: formats.time(midnight.set({ hour: i + 1 })),
      hidden: now !== null && Math.abs(now - (i + 1) * 60) < 15,
    }));
  });

  /** Now, in the gutter: its time, in primary, where the line runs. */
  protected readonly nowLabel = computed(() => {
    if (!this.shownDays().includes(this.today())) return null;
    const now = this.now();
    return {
      top: minuteOfDay(now),
      label: now.toLocaleString(DateTime.TIME_SIMPLE, { locale: this.#formats().language }),
    };
  });

  protected readonly band = computed(() => {
    const lifted = this.#lifted();
    const held = this.#held();
    // A timed mark across days stays in the hours, shown in each day — and
    // so does an event in hand (`#held`).
    const shown = this.#shown().filter(
      (event) => (event.id !== DRAFT_ID || event.allDay) && event.id !== held,
    );
    const placed = placeInLanes(shown, this.shownDays(), 'band');
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
    const held = this.#held();
    const shown = this.#shown();
    const events = shown.filter((event) => event.id !== DRAFT_ID && event.id !== held);
    const holding = shown.filter((event) => event.id === held);
    const mark = shown.filter((event) => event.id === DRAFT_ID);
    const today = this.today();
    const now = this.now();
    const heads = this.heads();
    return this.shownDays().map((day, i) => ({
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
          bare: false,
          foot: false,
        })),
        // The event in hand, across the days it runs over, as the mark.
        ...placeInDay(holding, day, { spanning: true }).map((one) => ({
          ...one,
          key: one.event.id,
          lines: one.length < 45 ? 1 : Math.max(1, Math.floor((one.length / 60) * 2.4) - 1),
          mark: false,
          lifted: one.event.id === lifted,
          bare: one.cutStart && one.cutEnd,
          foot: one.cutStart && !one.cutEnd,
        })),
        // The mark over them all, the column's whole width: Notion's. Over
        // days, its words on the first day and the last only — the days
        // between are its colour alone; on the last, at its foot (it
        // starts at midnight — the words would be out of sight there).
        ...placeInDay(mark, day, { spanning: true }).map((one) => ({
          ...one,
          key: one.event.id,
          lines: 1,
          mark: true,
          lifted: false,
          bare: one.cutStart && one.cutEnd,
          foot: one.cutStart && !one.cutEnd,
        })),
      ],
    }));
  });

  /** The quarter hour line under the mouse: its day and minute. */
  protected readonly hoverLine = computed(() =>
    this.#drag() || this.#marquee() ? null : this.#hover(),
  );

  /** The marquee's box, in the strip's room — once it was dragged. */
  /** The marquee's boxes, in the strip's room — once it was dragged. The
      band holds still over the hours, so a marquee with an end over it is
      two boxes: the band's days across (`band`), and the hours from the
      first in view (`hours`, none with both ends over the band). */
  protected readonly marqueeBox = computed(() => {
    const marquee = this.#marquee();
    if (!marquee?.moved) return null;
    const { from, to } = marquee;
    const firstInView = this.scrollTop() ?? 0;
    const y = (point: GridMarqueePoint) => (point.band ? firstInView : point.y);
    return {
      left: Math.min(from.x, to.x),
      width: Math.abs(to.x - from.x),
      band: !!(from.band || to.band),
      hours:
        from.band && to.band
          ? null
          : { top: Math.min(y(from), y(to)), height: Math.abs(y(to) - y(from)) },
    };
  });

  /** The events the marquee covers: their blocks in the hours, their bars
      in the band, by the numbers they are laid out by (the column's day,
      its share of it, minutes × the hour's height; a bar's days) — never
      measured. The mark is none of them. */
  readonly #marqueeHits = computed(() => {
    const box = this.marqueeBox();
    const width = this.columnWidth();
    if (!box || !width) return [];
    const { from } = this.window();
    const right = box.left + box.width;
    const hits = new Set<string>();
    const hours = box.hours;
    if (hours) {
      const bottom = hours.top + hours.height;
      this.columns().forEach((column, i) => {
        for (const one of column.events) {
          if (one.mark) continue;
          const share = (width - 8) / one.columns;
          const left = (from + i) * width + one.column * share;
          const top = (one.top / 60) * HOUR_HEIGHT;
          const height = (one.length / 60) * HOUR_HEIGHT;
          if (
            left < right &&
            left + share - 2 > box.left &&
            top < bottom &&
            top + height > hours.top
          ) {
            hits.add(one.event.id);
          }
        }
      });
    }
    if (box.band) {
      for (const bar of this.band().bars) {
        if (bar.mark) continue;
        const left = (from + bar.from) * width;
        if (left < right && left + bar.span * width > box.left) hits.add(bar.event.id);
      }
    }
    return [...hits];
  });

  constructor() {
    this.#destroyRef.onDestroy(() => {
      cancelAnimationFrame(this.#edgeFrame);
      clearTimeout(this.#settleLater);
    });

    // The hours open where they were — or an hour and a half before now,
    // or at 7 in the morning on a day without one. The days' room across,
    // as it changes: the columns share it.
    afterNextRender({
      write: () => {
        const scroller = this.scroller().nativeElement;
        const kept = this.scrollTop();
        const now = this.days().includes(this.today()) ? minuteOfDay(this.now()) - 90 : 7 * 60;
        scroller.scrollTop = kept ?? Math.max(0, (now / 60) * HOUR_HEIGHT);
        if (typeof ResizeObserver === 'undefined') return;
        const measure = () =>
          this.#width.set(
            Math.max(0, scroller.clientWidth - this.gutterEl().nativeElement.offsetWidth),
          );
        const observer = new ResizeObserver(measure);
        observer.observe(scroller);
        this.#destroyRef.onDestroy(() => observer.disconnect());
      },
    });

    // The page moved (the arrows, Today, a day in the mini month), or the
    // columns took a new width: straight there — not when the page only
    // follows where the strip already is.
    afterRenderEffect({
      write: () => {
        const index = this.#pageIndex();
        const width = this.columnWidth();
        if (!width) return;
        untracked(() => {
          if (index === this.#anchor && width === this.#laidAt) return;
          const to = index !== this.#anchor ? index : this.#anchor!;
          this.#anchor = to;
          this.#laidAt = width;
          this.#turningTo = null;
          this.#jump(to * width);
        });
      },
    });

    // Scrolled somewhere else: the page follows.
    effect(() => {
      const index = this.#viewIndex();
      untracked(() => {
        if (!this.columnWidth() || this.#anchor === null || index === this.#anchor) return;
        this.#anchor = index;
        this.rangeChange.emit(this.#dayOf(index));
      });
    });

    // The days drawn: the feed is asked for them.
    effect(() => {
      const { from, to } = this.window();
      untracked(() => this.windowChange.emit({ from: this.#dayOf(from), to: this.#dayOf(to - 1) }));
    });
  }

  /** Straight to a place sideways. */
  #jump(left: number): void {
    this.scroller().nativeElement.scrollLeft = left;
    this.#scrollLeft.set(left);
  }

  /** A point in the strip's room: px across from its first day — a point
      past the days in view on the edge's — and down from midnight. */
  #stripPoint(at: { clientX: number; clientY: number }): GridMarqueePoint {
    const box = this.columnsEl().nativeElement.getBoundingClientRect();
    const view = this.#daysInView();
    const x = view ? Math.min(view.right - 1, Math.max(view.left, at.clientX)) : at.clientX;
    return {
      x: x - box.left + this.window().from * this.columnWidth(),
      y:
        Math.min(DAY_MINUTES / 60, Math.max(0, (at.clientY - box.top) / HOUR_HEIGHT)) * HOUR_HEIGHT,
      // Over the band — or above it: past the hours' first in view.
      band: at.clientY < this.topEl().nativeElement.getBoundingClientRect().bottom,
    };
  }

  /** A Shift press on the hours — on an event too (`toggles`): a marquee
      begins there. */
  #beginMarquee(event: PointerEvent, toggles: string | null): void {
    if (event.pointerType === 'touch') return;
    this.columnsEl().nativeElement.setPointerCapture(event.pointerId);
    event.preventDefault();
    this.#turns.reset();
    const at = this.#stripPoint(event);
    this.#marquee.set({
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      from: at,
      to: at,
      toggles,
    });
  }

  protected scrolled(): void {
    const scroller = this.scroller().nativeElement;
    this.scrollTop.set(scroller.scrollTop);
    if (scroller.scrollLeft !== this.#scrollLeft()) {
      this.#scrollLeft.set(scroller.scrollLeft);
      // The days moved under the mouse: no line left where it was.
      this.#hover.set(null);
      if (!SCROLL_END) {
        clearTimeout(this.#settleLater);
        this.#settleLater = setTimeout(() => this.scrollEnded(), 150);
      }
    }
    // Scrolled under a drag: what is dragged follows the pointer.
    this.#follow();
  }

  /** The scroll's end: an edge's slides arrived; a scroll by hand eases
      on to the day nearest — the strip rests on a day's start, never
      across one. The browser's own snapping is not used: it computes the
      strip's days, but in this layout it stops applying them. */
  protected scrollEnded(): void {
    this.#turningTo = null;
    const width = this.columnWidth();
    if (!width) return;
    const scroller = this.scroller().nativeElement;
    const nearest = Math.round(scroller.scrollLeft / width) * width;
    if (Math.abs(nearest - scroller.scrollLeft) > 0.5) {
      scroller.scrollTo({ left: nearest, behavior: 'smooth' });
    }
  }

  protected headPressed(day: IsoDay): void {
    this.dayOpen.emit(day);
  }

  // ─── Pointer ────────────────────────────────────────────────────────

  /** The day (among those drawn) and minute under the pointer — a pointer
      past the days in view, over the gutter or beyond the scroller, on the
      day at that edge: the days drawn beyond it are out of sight. */
  #at(event: { clientX: number; clientY: number }): { day: number; minute: number } {
    const box = this.columnsEl().nativeElement.getBoundingClientRect();
    const count = this.shownDays().length;
    const rtl = getComputedStyle(this.columnsEl().nativeElement).direction === 'rtl';
    const view = this.#daysInView();
    const clientX = view
      ? Math.min(view.right - 1, Math.max(view.left, event.clientX))
      : event.clientX;
    const x = rtl ? box.right - clientX : clientX - box.left;
    // A grid not laid out (no width) has its pointer on the first day.
    const across = box.width > 0 ? x / box.width : 0;
    const day = Math.min(count - 1, Math.max(0, Math.floor(across * count)));
    const minute = Math.min(
      DAY_MINUTES,
      Math.max(0, ((event.clientY - box.top) / HOUR_HEIGHT) * 60),
    );
    return { day, minute };
  }

  /** The days' room in view, across: from the gutter's edge to the
      scroller's (its scrollbar left out). None before it is laid out. */
  #daysInView(): { left: number; right: number } | null {
    const scroller = this.scroller().nativeElement;
    if (!scroller.clientWidth) return null;
    const rtl = getComputedStyle(scroller).direction === 'rtl';
    const gutter = this.gutterEl().nativeElement.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const start = box.left + scroller.clientLeft;
    return rtl
      ? { left: start, right: gutter.left }
      : { left: gutter.right, right: start + scroller.clientWidth };
  }

  /** The slot under a pointer — the quarter of the hours, or the day of
      the all-day band — for what the page puts there (a paste). */
  slotAt(event: MouseEvent): GridSlot | null {
    const target = event.target as Element;
    const hours = target.closest('.time-grid__day');
    if (!hours && !target.closest('.time-grid__band')) return null;
    const { day, minute } = this.#at(event);
    const quarter = Math.min(DAY_MINUTES - SNAP, Math.floor(minute / SNAP) * SNAP);
    return { day: this.shownDays()[day], minute: hours ? quarter : null };
  }

  /** The quarter the pointer rests on, the hover line's — where a key's
      paste goes. */
  readonly hoveredSlot = computed<GridSlot | null>(() => {
    const hover = this.#hover();
    return hover ? { day: this.shownDays()[hover.day], minute: hover.minute } : null;
  });

  /** The moment at a row's minute on a drawn day — by the clock, so a
      press at 7:15 is 7:15 on the day the clocks change too. */
  #moment(day: number, minute: number): DateTime {
    return atMinute(parseDay(this.shownDays()[day])!, minute);
  }

  /** A press on an empty hour: a new event's mark begins at its quarter —
      with Shift, a marquee. */
  protected pressHours(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (event.shiftKey) {
      // Begun already where an event was pressed under it.
      if (!this.#marquee()) this.#beginMarquee(event, null);
      return;
    }
    if (!pressedEmptyOrMark(event)) return;
    const { day, minute } = this.#at(event);
    const anchor = Math.min(DAY_MINUTES - SNAP, Math.floor(minute / SNAP) * SNAP);
    this.#begin(event, {
      kind: 'mark',
      anchor,
      pressed: this.#moment(day, anchor),
      // A double press marks Notion's default: an hour from the quarter.
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

  /** A press on an event: a press opens it, a drag moves it. (On the mark,
      the hours' own press marks out anew.) */
  protected pressEvent(event: PointerEvent, shown: CalendarEvent): void {
    // The mark is room still being chosen: a press in it marks out anew
    // (the hours', the band's own press), it is not picked up.
    if (event.button !== 0 || event.pointerType === 'touch' || shown.id === DRAFT_ID) return;
    // With Shift: a marquee from here — or, never dragged, this one in the
    // selection or out.
    if (event.shiftKey) return this.#beginMarquee(event, shown.id);
    const source = this.#source(shown);
    // A holiday opens on its click; it never moves.
    if (!source || source.readonly) return;
    const { day, minute } = this.#at(event);
    const start = eventSpan(source).start;
    const startMinute = minutesInto(parseDay(this.shownDays()[day])!, start);
    this.#begin(event, {
      kind: 'move',
      anchor: minute - startMinute,
      pressed: this.#moment(day, 0),
      preview: source,
      element: event.currentTarget as Element,
    });
  }

  /** A press on an event's foot (or the mark's): a drag stretches it. */
  protected pressFoot(event: PointerEvent, shown: CalendarEvent): void {
    if (event.button !== 0 || event.shiftKey) return;
    const source = this.#source(shown);
    if (!source || source.readonly) return;
    event.stopPropagation();
    const { day } = this.#at(event);
    this.#begin(event, {
      kind: 'resize',
      anchor: 0,
      pressed: this.#moment(day, 0),
      preview: source,
    });
  }

  #begin(
    event: PointerEvent,
    drag: Pick<Drag, 'kind' | 'anchor' | 'pressed' | 'preview' | 'element'>,
  ): void {
    this.#turns.reset();
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
    const marquee = this.#marquee();
    if (marquee) {
      if (marquee.pointer !== event.pointerId) return;
      const moved =
        marquee.moved ||
        Math.hypot(event.clientX - marquee.x, event.clientY - marquee.y) > DRAG_THRESHOLD;
      if (!moved) return;
      this.#marquee.set({ ...marquee, moved, to: this.#stripPoint(event) });
      this.#pointerAt = { clientX: event.clientX, clientY: event.clientY };
      if (!this.#edgeFrame) {
        this.#edgeTime = performance.now();
        this.#edgeFrame = requestAnimationFrame((time) => this.#edgeStep(time));
      }
      return;
    }
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
    this.#pointerAt = { clientX: event.clientX, clientY: event.clientY };
    if (!this.#edgeFrame) {
      this.#edgeTime = performance.now();
      this.#edgeFrame = requestAnimationFrame((time) => this.#edgeStep(time));
    }
  }

  /** What is dragged, to what is under the pointer now — the strip or the
      hours moved under a pointer that did not. */
  #follow(): void {
    const marquee = this.#marquee();
    if (marquee?.moved && this.#pointerAt) {
      this.#marquee.set({ ...marquee, to: this.#stripPoint(this.#pointerAt) });
      return;
    }
    const drag = this.#drag();
    const at = this.#pointerAt;
    if (!drag?.moved || !at) return;
    const { day, minute } = this.#at(at);
    const preview = this.#previewAt(drag, day, minute);
    const was = drag.preview;
    if (preview.start !== was.start || preview.end !== was.end || preview.allDay !== was.allDay) {
      this.#drag.set({ ...drag, preview });
    }
  }

  /** A frame of a drag held at an edge — or past it. At the hours' top or
      foot they scroll on, the faster the further out (`EDGE_SPEED`); at
      the days' start or end the strip slides an interval on (`#slide`),
      and on (`EdgeTurns`) while it is held there. What is dragged runs on
      with them, to what is now under the pointer. Stops once the pointer
      leaves the edges, or the drag ends. */
  #edgeStep(time: number): void {
    this.#edgeFrame = 0;
    const drag = this.#drag();
    const marquee = this.#marquee();
    const at = this.#pointerAt;
    if (!(drag?.moved || marquee?.moved) || !at) {
      this.#turns.reset();
      return;
    }
    // By the time gone, at most a slow frame's: as fast at any frame rate.
    const seconds = Math.min(time - this.#edgeTime, 50) / 1000;
    this.#edgeTime = time;
    // The hours scroll for a drag in them — not one over the band (whole
    // days), nor a marquee's end over it, taking in the band's events.
    const scrolling = drag?.kind !== 'days' && !marquee?.to.band && this.#scrollStep(at, seconds);
    const turning = this.#turnStep(at, time);
    if (!scrolling && !turning) return;
    this.#follow();
    this.#edgeFrame = requestAnimationFrame((next) => this.#edgeStep(next));
  }

  /** The hours scrolled by a frame's worth, the pointer at their top (the
      heads' and the band's foot) or their foot: whether it is there, with
      room left to go. */
  #scrollStep(at: { clientY: number }, seconds: number): boolean {
    const scroller = this.scroller().nativeElement;
    const top = this.topEl().nativeElement.getBoundingClientRect().bottom;
    const bottom =
      scroller.getBoundingClientRect().top + scroller.clientTop + scroller.clientHeight;
    const up = top + EDGE - at.clientY;
    const down = at.clientY - (bottom - EDGE);
    const depth = Math.max(up, down);
    const room =
      up > 0
        ? scroller.scrollTop
        : scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    if (depth <= 0 || room <= 0) {
      this.#edgeCarry = 0;
      return false;
    }
    const speed = EDGE_SPEED * Math.min(1, EDGE_FLOOR + (1 - EDGE_FLOOR) * (depth / EDGE));
    this.#edgeCarry += (up > 0 ? -1 : 1) * speed * seconds;
    const step = Math.trunc(this.#edgeCarry);
    this.#edgeCarry -= step;
    scroller.scrollTop += step;
    return true;
  }

  /** The pointer at the days' start or end — the gutter's edge, the
      scroller's (its scrollbar left out) — and the strip slid when it comes
      there, and again while it is held (by the reading direction: the end
      is the next interval): whether it is there. */
  #turnStep(at: { clientX: number }, time: number): boolean {
    const view = this.#daysInView();
    if (!view) return false;
    const rtl = getComputedStyle(this.scroller().nativeElement).direction === 'rtl';
    const side =
      at.clientX < view.left + TURN_ZONE ? -1 : at.clientX > view.right - TURN_ZONE ? 1 : 0;
    const turn = this.#turns.at((rtl ? -side : side) as -1 | 0 | 1, time);
    if (turn) this.#slide(turn);
    return !!side;
  }

  /** The strip slid an interval on, Notion's: smoothly, from where the last
      slide was taking it if it is not there yet. */
  #slide(direction: -1 | 1): void {
    const width = this.columnWidth();
    if (!width) return;
    const to = (this.#turningTo ?? this.#viewIndex()) + direction * this.#perScreen();
    this.#turningTo = to;
    this.scroller().nativeElement.scrollTo({ left: to * width, behavior: 'smooth' });
  }

  /** The line on the quarter under the pointer — over an empty stretch of
      a day (`under`, the event's target unless told), none over an event. */
  #hoverAt(event: PointerEvent, under = event.target as Element | null): void {
    const over = under?.closest('.time-grid__day');
    if (!over || under !== over) return this.#hover.set(null);
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
      const pressed = drag.pressed;
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
      const pointer = this.#moment(day, 0);
      const from = DateTime.min(drag.pressed, pointer);
      const to = DateTime.max(drag.pressed, pointer);
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
    const marquee = this.#marquee();
    if (marquee && marquee.pointer === event.pointerId) {
      // Read before it goes: the events it covered.
      const hits = this.#marqueeHits();
      this.#marquee.set(null);
      this.#pointerAt = null;
      this.#swallowClick = true;
      setTimeout(() => (this.#swallowClick = false));
      if (marquee.moved) this.selectMany.emit(hits);
      else if (marquee.toggles) this.selectToggle.emit(marquee.toggles);
      return;
    }
    const drag = this.#drag();
    if (!drag || drag.pointer !== event.pointerId) return;
    this.#drag.set(null);
    this.#pointerAt = null;
    // The grid held the pointer, so the click this ends with lands on the
    // grid, not on what was pressed: a press is answered here, and the
    // click is spent.
    this.#swallowClick = true;
    setTimeout(() => (this.#swallowClick = false));
    // The line back where the pointer is let go. Held, the pointer's
    // target is the columns themselves — what is under it is asked for.
    if (event.pointerType === 'mouse') {
      const doc = this.columnsEl().nativeElement.ownerDocument;
      this.#hoverAt(event, doc.elementFromPoint(event.clientX, event.clientY));
    }

    const { id, ...draft } = drag.preview;
    if (drag.kind === 'mark' || drag.kind === 'days') {
      // Made by a drag let go, or a double press; a press alone only
      // closes what is open.
      const at = `${drag.kind}:${isoMoment(drag.pressed)}`;
      if (!drag.moved && !this.#presses.second(at, event.timeStamp)) {
        this.dismiss.emit();
        return;
      }
      const rect = drag.kind === 'mark' ? this.#markHead(drag) : this.#bandBox(drag.preview);
      this.create.emit({ draft, rect });
      return;
    }
    if (id === DRAFT_ID) {
      if (drag.moved) this.draftChange.emit({ draft, rect: this.#markHead(drag) });
      return;
    }
    if (!drag.moved) {
      if (drag.element) this.open.emit({ id, rect: headOf(drag.element) });
      return;
    }
    const stored = this.events().find((one) => one.id === id);
    if (stored && (stored.start !== drag.preview.start || stored.end !== drag.preview.end)) {
      this.change.emit(drag.preview);
    }
  }

  protected cancel(): void {
    this.#drag.set(null);
    this.#marquee.set(null);
    this.#pointerAt = null;
  }

  /** Escape lets go of a drag where it began — and is spent on it. */
  protected escape(event: Event): void {
    if (!this.#drag() && !this.#marquee()) return;
    event.preventDefault();
    this.#drag.set(null);
    this.#marquee.set(null);
    this.#pointerAt = null;
  }

  /** A click that came by keyboard (Enter, Space): the event opens. */
  protected clicked(event: MouseEvent, shown: CalendarEvent): void {
    if (this.#swallowClick) {
      this.#swallowClick = false;
      return;
    }
    if (shown.id === DRAFT_ID) return;
    this.open.emit({ id: shown.id, rect: headOf(event.currentTarget as Element) });
  }

  /** A press on the band: an all-day event that day. */
  protected pressBand(event: PointerEvent): void {
    if (event.button !== 0) return;
    // With Shift, a marquee from here — or, on a bar never dragged, that
    // event in the selection or out.
    if (event.shiftKey) {
      const bar = (event.target as Element).closest<HTMLElement>('[data-event-id]');
      const id = bar?.dataset['eventId'];
      return this.#beginMarquee(event, id && id !== DRAFT_ID ? id : null);
    }
    if (!pressedEmptyOrMark(event)) return;
    // The band's days line up with the hours' columns: the same tracks.
    const { day } = this.#at(event);
    if (event.pointerType !== 'touch') {
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
      event.preventDefault();
    }
    this.#turns.reset();
    this.#drag.set({
      kind: 'days',
      anchor: 0,
      pressed: this.#moment(day, 0),
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
    const days = this.shownDays();
    const count = days.length;
    const { start, end } = eventSpan(event);
    // By the days drawn: weekends hidden leave gaps the box closes over.
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

  /** The dragged mark's head, for its card (`headOf`) — where it begins,
      across days. Only a drag that moved has drawn it: a press alone still
      shows the mark before it (or none), so its place is worked out from
      its times — the page stands the card on the head once it is drawn. */
  #markHead(drag: Drag): AnchorRect {
    const drawn = drag.moved
      ? this.columnsEl().nativeElement.querySelector('[data-event-id="draft"]')
      : null;
    return drawn ? headOf(drawn) : this.#slotBox(drag.preview);
  }

  /** Where an event in the hours stands on screen — for its card, before
      (or while) it is drawn. */
  #slotBox(event: CalendarEvent): AnchorRect {
    const box = this.columnsEl().nativeElement.getBoundingClientRect();
    const days = this.shownDays();
    const { start, end } = eventSpan(event);
    const day = Math.max(days.indexOf(isoDay(start)), 0);
    const width = box.width / days.length;
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
