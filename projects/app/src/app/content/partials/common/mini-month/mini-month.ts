import {
  Component,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
} from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslatePipe } from '@ngx-translate/core';
import { DateTime } from 'luxon';

import {
  IsoDay,
  dayRange,
  daysBetween,
  isoDay,
  fixedWeeks,
  parseDay,
} from '../../../../core/calendar/calendar-dates';
import { CalendarFormat } from '../../../../core/calendar/calendar-format';

/** How many weeks the grid always shows: every month the same height, so
    turning one never moves what is under it. */
const WEEKS = 7;

/** A day of the grid, everything its button says worked out. */
interface MiniDay {
  day: IsoDay;
  number: number;
  label: string;
  outside: boolean;
  today: boolean;
  selected: boolean;
  /** The one tab stop. */
  stop: boolean;
}

/**
 * A month of days to pick one from — Notion Calendar's mini month: the
 * month's name and its two arrows, the week's letters, the days. Today is
 * a square in the theme's primary; the days
 * `selected` holds (the week a calendar shows) one band across them; days
 * of the months either side are faint, and there are always seven weeks of
 * them (`WEEKS`) — the grid never changes height as the months turn. Generic: it
 * knows days, not events — any date field can open one.
 *
 *     <mini-month [(month)]="shown" [selected]="days()" [today]="today()" (pick)="go($event)" />
 *
 * One tab stop, a grid's: the arrows move a day or a week, Page Up / Page
 * Down a month, Home / End to the week's ends, Enter or Space picks.
 * Moving off the month turns it — at once, nothing slides.
 *
 * Press a day and drag over others, and the run is marked as it goes —
 * Google Calendar's: let go on another day and the run is `pickRange`
 * (a press that stays on its day is a `pick`). The arrows can go
 * (`[steps]="false"`): the year view's twelve months hold still.
 */
@Component({
  selector: 'mini-month',
  host: { '(document:pointerup)': 'letGo()' },
  imports: [MatIconButton, MatIcon, MatTooltip, TranslatePipe],
  templateUrl: './mini-month.html',
  styleUrl: './mini-month.scss',
})
export class MiniMonth {
  readonly #formats = inject(CalendarFormat).formats;
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** A day of the month shown; the arrows move it. */
  readonly month = model.required<IsoDay>();
  /** The days to wash. */
  readonly selected = input<readonly IsoDay[]>([]);
  readonly today = input.required<IsoDay>();

  /** Whether the month's arrows show. */
  readonly steps = input(true, { transform: booleanAttribute });

  /** A day was picked. */
  readonly pick = output<IsoDay>();
  /** A run of days was dragged across, in order. */
  readonly pickRange = output<{ from: IsoDay; to: IsoDay }>();

  /** A drag across the days, while it lasts: where it began and is now. */
  readonly #range = signal<{ anchor: IsoDay; end: IsoDay } | null>(null);

  /** What is washed: the run being dragged, else what `selected` holds. */
  readonly #washed = computed<readonly IsoDay[]>(() => {
    const range = this.#range();
    if (!range) return this.selected();
    const [from, to] = [range.anchor, range.end].sort();
    return dayRange(parseDay(from)!, daysBetween(parseDay(from)!, parseDay(to)!) + 1);
  });

  /** The day the keyboard is on — the selection's first while it shows,
      today's otherwise; reset whenever the month turns without it. */
  readonly #cursor = linkedSignal<{ month: IsoDay; selected: readonly IsoDay[] }, IsoDay>({
    source: () => ({ month: this.month(), selected: this.selected() }),
    computation: ({ month, selected }, previous) => {
      const shown = (day: IsoDay | undefined) => !!day && day.slice(0, 7) === month.slice(0, 7);
      if (shown(previous?.value)) return previous!.value;
      if (shown(selected[0])) return selected[0];
      if (shown(this.today())) return this.today();
      return `${month.slice(0, 7)}-01`;
    },
  });

  /** Whether the cursor moved by key, so the grid takes focus to it. */
  #keyed = false;

  readonly #shown = computed(() => parseDay(this.month()) ?? parseDay(this.today())!);

  protected readonly title = computed(() => {
    const month = this.#shown();
    return this.#formats().title(month, month);
  });

  protected readonly weekdays = computed(() => {
    const formats = this.#formats();
    const [week] = fixedWeeks(this.#shown(), formats.weekStart, WEEKS);
    return week.map((day) => {
      const date = parseDay(day)!;
      return {
        day,
        narrow: formats.narrowWeekday(date),
        long: date.toLocaleString({ weekday: 'long' }, { locale: formats.language }),
      };
    });
  });

  protected readonly weeks = computed(() => {
    const formats = this.#formats();
    const shown = this.#shown();
    const selected = new Set(this.#washed());
    const today = this.today();
    const cursor = this.#cursor();
    return fixedWeeks(shown, formats.weekStart, WEEKS).map((week) => ({
      key: week[0],
      days: week.map((day, i): MiniDay => {
        const date = parseDay(day)!;
        const on = selected.has(day);
        return {
          day,
          number: date.day,
          label: formats.longDay(date),
          outside: !date.hasSame(shown, 'month'),
          today: day === today,
          selected: on,
          stop: day === cursor,
        };
      }),
    }));
  });

  constructor() {
    // A key moved the cursor: the focus follows it, on the new month's
    // button once it is drawn.
    afterRenderEffect(() => {
      const cursor = this.#cursor();
      if (!this.#keyed) return;
      this.#keyed = false;
      this.#host.querySelector<HTMLElement>(`[data-day="${cursor}"]`)?.focus();
    });
  }

  /** The previous (-1) or next (1) month. */
  protected step(direction: -1 | 1): void {
    this.month.set(isoDay(this.#shown().plus({ months: direction })));
  }

  /** A press on a day: a drag across days may begin. */
  protected press(event: PointerEvent, day: IsoDay): void {
    if (event.button !== 0) return;
    this.#range.set({ anchor: day, end: day });
  }

  /** The pointer over a day while pressed: the run reaches it. */
  protected over(event: PointerEvent): void {
    const range = this.#range();
    if (!range || !(event.buttons & 1)) return;
    const day = (event.target as Element).closest<HTMLElement>('[data-day]')?.dataset['day'];
    if (day && day !== range.end) this.#range.set({ ...range, end: day });
  }

  /** Let go: a run of more than its day is picked as one. */
  protected letGo(): void {
    const range = this.#range();
    if (!range) return;
    this.#range.set(null);
    if (range.anchor === range.end) return; // The click picks it.
    const [from, to] = [range.anchor, range.end].sort();
    this.pickRange.emit({ from, to });
  }

  protected picked(day: IsoDay): void {
    this.#cursor.set(day);
    this.pick.emit(day);
  }

  protected keydown(event: KeyboardEvent): void {
    const cursor = parseDay(this.#cursor());
    if (!cursor) return;
    const rtl = getComputedStyle(this.#host).direction === 'rtl' ? -1 : 1;
    const weekStart = this.#formats().weekStart;
    const offset = (cursor.weekday - weekStart + 7) % 7;
    const moves: Record<string, () => DateTime> = {
      ArrowLeft: () => cursor.minus({ days: rtl }),
      ArrowRight: () => cursor.plus({ days: rtl }),
      ArrowUp: () => cursor.minus({ weeks: 1 }),
      ArrowDown: () => cursor.plus({ weeks: 1 }),
      PageUp: () => cursor.minus({ months: 1 }),
      PageDown: () => cursor.plus({ months: 1 }),
      Home: () => cursor.minus({ days: offset }),
      End: () => cursor.plus({ days: 6 - offset }),
    };
    const to = moves[event.key]?.();
    if (!to) return;
    event.preventDefault();
    if (!to.hasSame(this.#shown(), 'month')) this.month.set(isoDay(to));
    this.#keyed = true;
    this.#cursor.set(isoDay(to));
  }
}
