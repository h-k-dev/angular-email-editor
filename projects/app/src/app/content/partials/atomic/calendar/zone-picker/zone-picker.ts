import {
  Component,
  afterRenderEffect,
  computed,
  input,
  linkedSignal,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { CdkConnectedOverlay } from '@angular/cdk/overlay';
import { Combobox, ComboboxPopup, ComboboxWidget } from '@angular/aria/combobox';
import { Listbox, Option } from '@angular/aria/listbox';
import { DateTime } from 'luxon';

import { QuietField } from '../../../common/quiet-field/quiet-field';
import { isoDay, parseDay } from '../../../../../core/calendar/calendar-dates';
import { matchZones, zoneChoice, zoneChoices } from '../../../../../core/calendar/time-zones';

/**
 * The zone an event is written in, Notion Calendar's: the offset, quiet
 * (GMT+1), then the place (Berlin) — the place a field to type in. Typing
 * finds zones by place, region or offset; the list runs west to east.
 * Angular Aria's combobox over its listbox: the keys stay in the field, the
 * list follows (`aria-activedescendant`), Enter or a press picks, Escape
 * lets go.
 *
 * Offsets are the day's (`at`): a summer event in Berlin says GMT+2.
 */
@Component({
  selector: 'calendar-zone-picker',
  imports: [
    CdkConnectedOverlay,
    Combobox,
    ComboboxPopup,
    ComboboxWidget,
    Listbox,
    Option,
    QuietField,
  ],
  templateUrl: './zone-picker.html',
  styleUrl: './zone-picker.scss',
})
export class ZonePicker {
  /** The zone, an IANA name. */
  readonly zone = model.required<string>();
  /** When the event starts: the day the offsets are taken on. */
  readonly at = input.required<DateTime>();
  /** What the field is called, for assistive tech. */
  readonly label = input('');

  /** The day alone: the list is built again only when it changes. */
  readonly #day = computed(() => isoDay(this.at()));
  readonly #zones = computed(() => zoneChoices(parseDay(this.#day())!));

  protected readonly current = computed(() => zoneChoice(this.zone(), this.at()));

  /** What the field holds: the place, until typed over. */
  protected readonly query = linkedSignal(() => this.current().place);
  protected readonly expanded = signal(false);

  /** Every zone while the field still says the place; else the ones that
      hold what is typed. */
  protected readonly shown = computed(() => {
    const query = this.query();
    const zones = this.#zones();
    return query === this.current().place ? zones : matchZones(zones, query);
  });
  protected readonly selected = computed(() => [this.zone()]);

  private readonly listbox = viewChild(Listbox);

  constructor() {
    // The list drawn: on the event's zone, in the middle of it — or, typed
    // over, on the first zone found, where Enter lands.
    afterRenderEffect(() => {
      this.shown();
      const list = this.listbox();
      if (!list || !this.expanded()) return;
      if (this.query() !== this.current().place) list.gotoFirst();
      else list.scrollActiveItemIntoView({ block: 'center' });
    });
  }

  /** Into the field: the place selected, to be typed over, and the list
      open on the zone. */
  protected focused(event: FocusEvent): void {
    (event.target as HTMLInputElement).select();
    this.setExpanded(true);
  }

  protected setExpanded(open: boolean): void {
    this.expanded.set(open);
    if (!open) this.query.set(this.current().place);
  }

  /** A zone picked — Enter, or a press. */
  protected picked(values: readonly string[]): void {
    const [id] = values;
    // None: the listbox letting go of a zone the typing filtered out —
    // nothing was picked.
    if (!id) return;
    this.zone.set(id);
    this.setExpanded(false);
  }
}
