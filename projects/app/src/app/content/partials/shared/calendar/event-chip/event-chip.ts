import { Component, booleanAttribute, computed, inject, input } from '@angular/core';

import {
  CalendarEvent,
  EVENT_COLOR_VALUES,
  eventSpan,
} from '../../../../../core/calendar/calendar-event';
import { CalendarFormat } from '../../../../../core/calendar/calendar-format';

/**
 * How an event reads where it is laid out:
 * - `block` — in a day's hours: its title over its times, as tall as it
 *   lasts (the grid sets its box);
 * - `bar` — across days, in a band or a month's row: a filled bar, its
 *   title alone;
 * - `item` — a timed event in a month's day: a dot of its colour, its
 *   time, its title — no fill, Google's.
 */
export type EventChipShape = 'block' | 'bar' | 'item';

/**
 * One event, as every surface shows it — the calendar's grids now, an
 * invitation in a message later: Notion Calendar's chip, a wash of the
 * event's colour with a solid edge, its ink a deep shade of the colour in
 * light and a pale one in dark. Worn by the element that opens it, a
 * button, so the chip is the press target and its words are its name:
 *
 *     <button type="button" [calendarEventChip]="event" shape="block"></button>
 *
 * Laid out by its container (position, size); it draws only itself. A
 * new event being marked out wears `mark` — Notion's selection: the
 * colour at an eighth, flat and square, its times in it; one being dragged
 * `lifted`. Nothing springs or pops: it is where the pointer says, at
 * once.
 */
@Component({
  selector: '[calendarEventChip]',
  template: `
    @if (shape() === 'item') {
      <span class="event-chip__dot" aria-hidden="true"></span>
      @if (time(); as time) {
        <span class="event-chip__time">{{ time }}</span>
      }
      <span class="event-chip__title">{{ title() }}</span>
    } @else {
      <span class="event-chip__title">{{ title() }}</span>
      @if (shape() === 'block' && time(); as time) {
        <span class="event-chip__time">{{ time }}</span>
      }
    }
  `,
  styleUrl: './event-chip.scss',
  host: {
    class: 'event-chip',
    '[attr.data-shape]': 'shape()',
    '[class.event-chip--mark]': 'mark()',
    '[class.event-chip--lifted]': 'lifted()',
    '[class.event-chip--cut-before]': 'cutBefore()',
    '[class.event-chip--cut-after]': 'cutAfter()',
    '[style.--event-color]': 'color()',
  },
})
export class EventChip {
  readonly #formats = inject(CalendarFormat).formats;

  readonly event = input.required<
    Pick<CalendarEvent, 'title' | 'start' | 'end' | 'allDay' | 'color'>
  >({
    alias: 'calendarEventChip',
  });
  readonly shape = input<EventChipShape>('block');
  /** What it says while it has no title of its own: "(No title)". */
  readonly untitled = input('');
  readonly mark = input(false, { transform: booleanAttribute });
  readonly lifted = input(false, { transform: booleanAttribute });
  /** A bar that began before the run it is in, or goes on after it: its
      end is cut square. */
  readonly cutBefore = input(false, { transform: booleanAttribute });
  readonly cutAfter = input(false, { transform: booleanAttribute });

  protected readonly color = computed(() => EVENT_COLOR_VALUES[this.event().color]);

  protected readonly title = computed(() => this.event().title.trim() || this.untitled());

  /** Its times — a block's two, an item's start; none all day. */
  protected readonly time = computed(() => {
    const event = this.event();
    if (event.allDay) return '';
    const { start, end } = eventSpan(event);
    const formats = this.#formats();
    if (this.shape() !== 'block') return formats.time(start);
    // Across a midnight (a mark dragged over days): the days say which.
    return start.hasSame(end.minus({ milliseconds: 1 }), 'day')
      ? formats.timeRange(start, end)
      : formats.dayTimeRange(start, end);
  });
}
