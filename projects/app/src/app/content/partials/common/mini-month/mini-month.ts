import {
  Component,
  ElementRef,
  afterRenderEffect,
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

import { IsoDay, isoDay, monthWeeks, parseDay } from '../../../../core/calendar/calendar-dates';
import { CalendarFormat } from '../../../../core/calendar/calendar-format';

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
 * A month of days to pick one from — Google Calendar's mini month, Linear's
 * quiet: the month's name and its two arrows, the week's letters, the days.
 * Today is a filled circle, the days `selected` holds (the week a calendar
 * shows) a wash; days of the months either side are faint. Generic: it
 * knows days, not events — any date field can open one.
 *
 *     <mini-month [(month)]="shown" [selected]="days()" [today]="today()" (pick)="go($event)" />
 *
 * One tab stop, a grid's: the arrows move a day or a week, Page Up / Page
 * Down a month, Home / End to the week's ends, Enter or Space picks.
 * Moving off the month turns it. A turn slides the days in from the side
 * they come from (styles/_motion.scss, `motion-turn`).
 */
@Component({
  selector: 'mini-month',
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

  /** A day was picked. */
  readonly pick = output<IsoDay>();

  /** Which way the last turn went: the next month slides in from the end. */
  protected readonly turn = signal<-1 | 0 | 1>(0);

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

  /** The page's key: one per month, so a turn enters a new one. */
  protected readonly page = computed(() => [this.month().slice(0, 7)]);

  protected readonly weekdays = computed(() => {
    const formats = this.#formats();
    const [week] = monthWeeks(this.#shown(), formats.weekStart);
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
    const selected = new Set(this.selected());
    const today = this.today();
    const cursor = this.#cursor();
    return monthWeeks(shown, formats.weekStart).map((week) => ({
      key: week[0],
      days: week.map((day): MiniDay => {
        const date = parseDay(day)!;
        return {
          day,
          number: date.day,
          label: formats.longDay(date),
          outside: !date.hasSame(shown, 'month'),
          today: day === today,
          selected: selected.has(day),
          stop: day === cursor,
        };
      }),
    }));
  });

  constructor() {
    // A key moved the cursor: the focus follows it, on the new month's
    // button once a turn has drawn it.
    afterRenderEffect(() => {
      const cursor = this.#cursor();
      if (!this.#keyed) return;
      this.#keyed = false;
      this.#host
        .querySelector<HTMLElement>(
          `.mini-month__page:not(.motion-turn-leave) [data-day="${cursor}"]`,
        )
        ?.focus();
    });
  }

  /** The previous (-1) or next (1) month. */
  protected step(direction: -1 | 1): void {
    const month = this.#shown().plus({ months: direction });
    this.turn.set(direction);
    this.month.set(isoDay(month));
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
    if (!to.hasSame(this.#shown(), 'month')) {
      this.turn.set(to < cursor ? -1 : 1);
      this.month.set(isoDay(to));
    }
    this.#keyed = true;
    this.#cursor.set(isoDay(to));
  }
}
