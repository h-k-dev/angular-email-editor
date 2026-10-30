import {
  Component,
  inject,
  ElementRef,
  afterNextRender,
  computed,
  input,
  linkedSignal,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, FormRoot, form, validate } from '@angular/forms/signals';
import { DateTime } from 'luxon';

// Angular Material
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslatePipe } from '@ngx-translate/core';

import { MenuTrigger } from '@angular/aria/menu';

import { mapsUrl } from '../../../../../core/calendar/maps';
import { I18n } from '../../../../../core/translations/i18n';
import { DateField } from '../../../common/date-field/date-field';
import {
  ToolbarMenu,
  ToolbarMenuItem,
} from '../../../shared/email/email-compose/formatting-toolbar/toolbar-menu/toolbar-menu';
import { HoverCard } from '../../../common/hover-card/hover-card';
import { QuietField } from '../../../common/quiet-field/quiet-field';

import {
  daysBetween,
  isoDay,
  isoMoment,
  parseDay,
  parseMoment,
} from '../../../../../core/calendar/calendar-dates';
import {
  DEFAULT_EVENT_MINUTES,
  EVENT_COLORS,
  EVENT_COLOR_VALUES,
  EventColor,
  EventEdit,
  eventSpan,
} from '../../../../../core/calendar/calendar-event';

/** The fields, as the inputs hold them: days `yyyy-MM-dd`, times `HH:mm`
    — and an all-day event's end day inclusive, as a person says it. */
interface EditorFields {
  title: string;
  allDay: boolean;
  startDay: string;
  startTime: string;
  endDay: string;
  endTime: string;
  color: EventColor;
  location: string;
  description: string;
}

function toFields(edit: EventEdit): EditorFields {
  const { start, end } = eventSpan(edit);
  const last = edit.allDay ? end.minus({ days: 1 }) : end;
  return {
    title: edit.title,
    allDay: edit.allDay,
    startDay: isoDay(start),
    startTime: start.toFormat('HH:mm'),
    endDay: isoDay(DateTime.max(last, start)),
    endTime: end.toFormat('HH:mm'),
    color: edit.color,
    location: edit.location,
    description: edit.description,
  };
}

/** The fields back as an edit — or the edit unchanged in its moments while
    a field holds no day or time yet (an input being cleared and typed). */
function fromFields(fields: EditorFields, previous: EventEdit): EventEdit {
  const base = {
    ...previous,
    title: fields.title,
    allDay: fields.allDay,
    color: fields.color,
    location: fields.location,
    description: fields.description,
  };
  if (fields.allDay) {
    const start = parseDay(fields.startDay);
    const last = parseDay(fields.endDay);
    if (!start || !last) return base;
    return {
      ...base,
      start: isoMoment(start),
      end: isoMoment(DateTime.max(last, start).plus({ days: 1 })),
    };
  }
  const start = parseMoment(`${fields.startDay}T${fields.startTime}`);
  const end = parseMoment(`${fields.endDay}T${fields.endTime}`);
  if (!start || !end) return base;
  return { ...base, start: isoMoment(start), end: isoMoment(end) };
}

/**
 * A start moved and the end left as it was: the end moves with it, so the
 * event keeps its length — Google's. An all-day event by whole days; a
 * timed one by the time between, across midnight if need be. A change to
 * the end itself, or to all day, is left alone.
 */
function keepLength(before: EditorFields, after: EditorFields): EditorFields {
  const startMoved = after.startDay !== before.startDay || after.startTime !== before.startTime;
  const endTouched = after.endDay !== before.endDay || after.endTime !== before.endTime;
  if (!startMoved || endTouched || after.allDay !== before.allDay) return after;
  if (after.allDay) {
    const from = parseDay(before.startDay);
    const to = parseDay(after.startDay);
    const end = parseDay(before.endDay);
    if (!from || !to || !end) return after;
    return { ...after, endDay: isoDay(end.plus({ days: daysBetween(from, to) })) };
  }
  const from = parseMoment(`${before.startDay}T${before.startTime}`);
  const to = parseMoment(`${after.startDay}T${after.startTime}`);
  const end = parseMoment(`${before.endDay}T${before.endTime}`);
  if (!from || !to || !end) return after;
  const moved = to.plus(end.diff(from));
  return { ...after, endDay: isoDay(moved), endTime: moved.toFormat('HH:mm') };
}

const sameEdit = (a: EventEdit, b: EventEdit): boolean =>
  (Object.keys(b) as (keyof EventEdit)[]).every((key) => a[key] === b[key]);

/**
 * An event, written: Notion Calendar's card — the title large on top, when
 * it starts and ends, all day or not, its colour, where, and a note; Save
 * and (for a stored one) Delete at its foot. The card is the page's to
 * place (beside the event, in an overlay); this is what is in it.
 *
 * The edit is a two-way `value`, written through as it is typed: the grids
 * show the event where it will be while the card is open, and the page
 * only stores it on `save`. The fields are one signal form; Save (and
 * Enter in the title) submits it, and an end before the start does not
 * go through.
 */
@Component({
  selector: 'calendar-event-editor',
  imports: [
    DateField,
    MenuTrigger,
    ToolbarMenu,
    FormRoot,
    FormField,
    HoverCard,
    MatButton,
    MatIconButton,
    MatIcon,
    MatTooltip,
    QuietField,
    TranslatePipe,
  ],
  templateUrl: './event-editor.html',
  styleUrl: './event-editor.scss',
  host: { '[style.--event-color]': 'color()' },
})
export class EventEditor {
  readonly #i18n = inject(I18n);

  readonly value = model.required<EventEdit>();
  /** Whether the event is stored already: it can be deleted. */
  readonly stored = input(false);

  readonly save = output<EventEdit>();
  readonly remove = output<void>();
  readonly close = output<void>();

  protected readonly titleInput = viewChild.required<ElementRef<HTMLInputElement>>('title');

  /** The fields over the edit: a field typed writes the edit through (the
      grids follow); an edit from outside (a drag) resets the fields. */
  readonly #fields = linkedSignal<EventEdit, EditorFields>({
    source: this.value,
    // The fields as typed while they still say this edit — a date being
    // retyped holds nothing for a moment, and must not snap back.
    computation: (edit, previous) =>
      previous && sameEdit(fromFields(previous.value, edit), edit)
        ? previous.value
        : toFields(edit),
    // A start moved carries the end along (`keepLength`).
    set: (fields, rawSet) => {
      const kept = keepLength(this.#fields(), fields);
      rawSet(kept);
      this.value.set(fromFields(kept, this.value()));
    },
  });

  protected readonly editor = form(
    this.#fields,
    (p) => {
      validate(p.endTime, ({ valueOf }) => {
        if (valueOf(p.allDay)) return null;
        const start = parseMoment(`${valueOf(p.startDay)}T${valueOf(p.startTime)}`);
        const end = parseMoment(`${valueOf(p.endDay)}T${valueOf(p.endTime)}`);
        return start && end && end <= start ? { kind: 'calendar.endsBeforeStart' } : null;
      });
      validate(p.endDay, ({ valueOf }) =>
        valueOf(p.endDay) < valueOf(p.startDay) ? { kind: 'calendar.endsBeforeStart' } : null,
      );
    },
    {
      name: 'event',
      submission: {
        action: async () => {
          this.save.emit(this.value());
          return undefined;
        },
        onInvalid: (field) => field().errorSummary()[0]?.fieldTree().focusBoundControl(),
      },
    },
  );

  protected readonly allDay = computed(() => this.#fields().allDay);

  /** The end said wrong — after a try, or as soon as the times disagree. */
  protected readonly endRefused = computed(
    () => this.editor.endTime().invalid() || this.editor.endDay().invalid(),
  );

  protected readonly color = computed(() => EVENT_COLOR_VALUES[this.#fields().color]);

  /** The colour menu: Google's eleven, each its dot and its name, the
      event's ticked. */
  protected readonly colors = computed<ToolbarMenuItem<EventColor>[]>(() => {
    const picked = this.#fields().color;
    return EVENT_COLORS.map((id) => ({
      value: id,
      label: this.#i18n.t(`calendar.colors.${id}`),
      swatch: EVENT_COLOR_VALUES[id],
      kind: 'radio',
      checked: id === picked,
    }));
  });

  /** Where the place is on Google Maps — none for no place — and the card
      with the way there: only while the place is typed in. */
  protected readonly mapsLink = computed(() => mapsUrl(this.#fields().location));
  protected readonly placeTyping = signal(false);
  protected readonly placeCardOff = computed(() => !this.placeTyping() || !this.mapsLink());

  /** The marker's name: "Color: Peacock". */
  protected readonly colorLabel = computed(
    () =>
      `${this.#i18n.t('calendar.color')}: ${this.#i18n.t(`calendar.colors.${this.#fields().color}`)}`,
  );

  constructor() {
    afterNextRender(() => this.titleInput().nativeElement.focus());
  }

  protected pickColor(color: EventColor): void {
    this.editor.color().value.set(color);
  }

  /** All day off: a timed event at the hour, as long as Google's. */
  protected allDayChanged(): void {
    const fields = this.#fields();
    if (fields.allDay || fields.startTime !== '00:00' || fields.endTime !== '00:00') return;
    const start = parseDay(fields.startDay)!.set({ hour: 9 });
    this.editor.startTime().value.set(start.toFormat('HH:mm'));
    this.editor.endDay().value.set(fields.startDay);
    this.editor
      .endTime()
      .value.set(start.plus({ minutes: DEFAULT_EVENT_MINUTES }).toFormat('HH:mm'));
  }
}
