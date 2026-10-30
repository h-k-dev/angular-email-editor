import { Component, booleanAttribute, computed, inject, input, output } from '@angular/core';

// Angular Material
import { MatTooltip } from '@angular/material/tooltip';

// Aria
import { MenuTrigger } from '@angular/aria/menu';
import { TranslatePipe } from '@ngx-translate/core';

import {
  EVENT_COLORS,
  EVENT_COLOR_VALUES,
  EventColor,
} from '../../../../../core/calendar/calendar-event';
import { I18n } from '../../../../../core/translations/i18n';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../../email/email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';

/**
 * An event's colour at the head of its card: a round dot in a round quiet
 * button that opens the colour menu — Google's eleven, each its dot and its
 * name, the event's ticked, a letter typed going to the colour it starts
 * (the Aria menu's typeahead). The menu opens with the event's own dot on
 * the marker (`anchor="selected"`). The card that is writing the event and
 * the card that shows it wear the same one; a colour that cannot be changed
 * (a holiday's) is the dot alone, named.
 *
 *     <calendar-color-marker [color]="event.color" (picked)="recolor($event)" />
 */
@Component({
  selector: 'calendar-color-marker',
  imports: [MatTooltip, MenuTrigger, ToolbarMenu, TranslatePipe],
  template: `
    @if (readonly()) {
      <span class="color-marker" role="img" [attr.aria-label]="label()">
        <span class="color-marker__dot"></span>
      </span>
    } @else {
      <button
        type="button"
        class="color-marker color-marker--button"
        [attr.aria-label]="label()"
        [matTooltip]="label()"
        ngMenuTrigger
        #trigger="ngMenuTrigger"
        [menu]="menu.menu()"
      >
        <span class="color-marker__dot" aria-hidden="true"></span>
      </button>
      <div
        toolbar-menu
        #menu
        anchor="selected"
        [label]="'calendar.color' | translate"
        [trigger]="trigger"
        [items]="items()"
        (selected)="picked.emit($event)"
      ></div>
    }
  `,
  styleUrl: './color-marker.scss',
  host: { '[style.--event-color]': 'value()' },
})
export class ColorMarker {
  readonly #i18n = inject(I18n);

  /** The event's colour. */
  readonly color = input.required<EventColor>();
  /** The dot alone: a colour that is not the viewer's to change. */
  readonly readonly = input(false, { transform: booleanAttribute });
  /** A colour was chosen from the menu. */
  readonly picked = output<EventColor>();

  protected readonly value = computed(() => EVENT_COLOR_VALUES[this.color()]);

  /** Its name: "Color: Peacock". */
  protected readonly label = computed(
    () => `${this.#i18n.t('calendar.color')}: ${this.#i18n.t(`calendar.colors.${this.color()}`)}`,
  );

  protected readonly items = computed<ToolbarMenuItem<EventColor>[]>(() => {
    const picked = this.color();
    return EVENT_COLORS.map((id) => ({
      value: id,
      label: this.#i18n.t(`calendar.colors.${id}`),
      swatch: EVENT_COLOR_VALUES[id],
      kind: 'radio',
      checked: id === picked,
    }));
  });
}
