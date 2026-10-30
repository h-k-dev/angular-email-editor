import { Component, input, output } from '@angular/core';

import { IsoDay } from '../../../../../core/calendar/calendar-dates';
import { MiniMonth } from '../../../common/mini-month/mini-month';

/**
 * The year, Google Calendar's: its twelve months, a mini month each, four
 * across (fewer as the room narrows). Press a day and it opens alone
 * (`dayOpen`); drag across days, as in the side's mini month, and the run
 * is asked for (`pickRange`).
 */
@Component({
  selector: 'calendar-year-grid',
  imports: [MiniMonth],
  template: `
    @for (month of months(); track month) {
      <mini-month
        class="year-grid__month"
        [month]="month"
        [steps]="false"
        [today]="today()"
        (pick)="dayOpen.emit($event)"
        (pickRange)="pickRange.emit($event)"
      />
    }
  `,
  styles: `
    @use '@h-k-dev/angular-email-editor/styles/scroll';

    :host {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(216px, 1fr));
      align-content: start;
      justify-items: center;
      gap: 24px 32px;
      min-block-size: 0;
      padding: 16px 24px 24px;
      overflow-y: auto;
      box-sizing: border-box;
      @include scroll.scroll;
    }

    .year-grid__month {
      max-inline-size: 240px;
    }
  `,
})
export class YearGrid {
  /** Each month's first day. */
  readonly months = input.required<readonly IsoDay[]>();
  readonly today = input.required<IsoDay>();

  readonly dayOpen = output<IsoDay>();
  readonly pickRange = output<{ from: IsoDay; to: IsoDay }>();
}
