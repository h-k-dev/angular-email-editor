import { Component, computed, inject, input, output } from '@angular/core';

import { TranslatePipe } from '@ngx-translate/core';

import { IsoDay, parseDay } from '../../../../../core/calendar/calendar-dates';
import {
  CalendarEvent,
  EVENT_COLOR_VALUES,
  eventSpan,
} from '../../../../../core/calendar/calendar-event';
import { CalendarFormat } from '../../../../../core/calendar/calendar-format';
import { GridOpen, boxOf } from '../calendar-grid';

/**
 * The schedule, Google Calendar's: the days ahead that hold anything, each
 * with its events in a list — a dot of the event's colour, when, the
 * title. Days with nothing are left out; today keeps its row, saying so.
 * Press an event and it opens (`open`); press a day's date and the day
 * opens alone (`dayOpen`).
 */
@Component({
  selector: 'calendar-schedule-list',
  imports: [TranslatePipe],
  templateUrl: './schedule-list.html',
  styleUrl: './schedule-list.scss',
})
export class ScheduleList {
  readonly #formats = inject(CalendarFormat).formats;

  readonly days = input.required<readonly IsoDay[]>();
  readonly events = input.required<readonly CalendarEvent[]>();
  readonly today = input.required<IsoDay>();
  readonly untitled = input('');

  readonly open = output<GridOpen>();
  readonly dayOpen = output<IsoDay>();

  protected readonly rows = computed(() => {
    const formats = this.#formats();
    const today = this.today();
    const untitled = this.untitled();
    const events = this.events().map((event) => ({ event, ...eventSpan(event) }));
    return this.days()
      .map((day) => {
        const midnight = parseDay(day)!;
        const next = midnight.plus({ days: 1 });
        const items = events
          .filter(({ start, end }) => start < next && (end > midnight || +start === +end))
          .sort((a, b) => Number(b.event.allDay) - Number(a.event.allDay) || +a.start - +b.start)
          .map(({ event, start, end }) => ({
            key: event.id,
            event,
            color: EVENT_COLOR_VALUES[event.color],
            title: event.title.trim() || untitled,
            when: event.allDay
              ? ''
              : formats.timeRange(start < midnight ? midnight : start, end > next ? next : end),
          }));
        return {
          day,
          today: day === today,
          number: midnight.day,
          label: midnight.toLocaleString(
            { month: 'short', weekday: 'short' },
            { locale: formats.language },
          ),
          longDay: formats.longDay(midnight),
          items,
        };
      })
      .filter((row) => row.items.length || row.today);
  });

  protected readonly empty = computed(() => !this.rows().some((row) => row.items.length));

  protected pressed(event: MouseEvent, id: string): void {
    this.open.emit({ id, rect: boxOf(event.currentTarget as Element) });
  }
}
