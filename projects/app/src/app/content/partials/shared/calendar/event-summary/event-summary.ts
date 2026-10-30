import { Component, computed, inject, input } from '@angular/core';

// Angular Material
import { MatIcon } from '@angular/material/icon';

import { CalendarEvent, EVENT_COLOR_VALUES } from '../../../../../core/calendar/calendar-event';
import { CalendarFormat } from '../../../../../core/calendar/calendar-format';
import { mapsUrl } from '../../../../../core/calendar/maps';

/**
 * An event, told: its colour and title, when it is, where, and what it
 * says — Google's event card. The calendar shows it when an event is
 * pressed; an invitation in a message is meant to show the same card, so
 * it takes an event and nothing of the calendar around it. What can be
 * done with the event (edit, delete, close) is the host's, projected on
 * top:
 *
 *     <calendar-event-summary [event]="event" untitled="(No title)">
 *       <div eventSummaryActions>…</div>
 *     </calendar-event-summary>
 */
@Component({
  selector: 'calendar-event-summary',
  imports: [MatIcon],
  template: `
    <ng-content select="[eventSummaryActions]" />
    <div class="event-summary__row">
      <span class="event-summary__swatch" aria-hidden="true"></span>
      <div class="event-summary__head">
        <h2 class="event-summary__title" [class.event-summary__title--none]="!titled()">
          {{ title() }}
        </h2>
        <p class="event-summary__when">{{ when() }}</p>
      </div>
    </div>
    @if (event().location.trim(); as location) {
      <div class="event-summary__row">
        <mat-icon class="event-summary__icon" aria-hidden="true">location_on</mat-icon>
        <!-- The place, on Google Maps. -->
        <p class="event-summary__text">
          <a
            class="event-summary__link"
            [href]="mapsLink()"
            target="_blank"
            rel="noopener noreferrer"
            >{{ location }}</a
          >
        </p>
      </div>
    }
    @if (event().description.trim(); as description) {
      <div class="event-summary__row">
        <mat-icon class="event-summary__icon" aria-hidden="true">notes</mat-icon>
        <p class="event-summary__text event-summary__text--long">{{ description }}</p>
      </div>
    }
  `,
  styleUrl: './event-summary.scss',
  host: { '[style.--event-color]': 'color()' },
})
export class EventSummary {
  readonly #formats = inject(CalendarFormat).formats;

  readonly event = input.required<Omit<CalendarEvent, 'id'>>();
  /** What it says while the event has no title. */
  readonly untitled = input('');

  protected readonly color = computed(() => EVENT_COLOR_VALUES[this.event().color]);
  protected readonly titled = computed(() => !!this.event().title.trim());
  protected readonly title = computed(() => this.event().title.trim() || this.untitled());
  protected readonly when = computed(() => this.#formats().when(this.event()));
  /** Where the place is on Google Maps. */
  protected readonly mapsLink = computed(() => mapsUrl(this.event().location));
}
