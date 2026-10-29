import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  linkedSignal,
  model,
  output,
  viewChild,
} from '@angular/core';
import { FormField, FormRoot, form, validate } from '@angular/forms/signals';
import { DateTime } from 'luxon';

// Angular Material
import { MatButton, MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslatePipe } from '@ngx-translate/core';

import {
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
  imports: [FormRoot, FormField, MatButton, MatIconButton, MatIcon, MatTooltip, TranslatePipe],
  templateUrl: './event-editor.html',
  styleUrl: './event-editor.scss',
  host: { '[style.--event-color]': 'color()' },
})
export class EventEditor {
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
    set: (fields, rawSet) => {
      rawSet(fields);
      this.value.set(fromFields(fields, this.value()));
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

  protected readonly swatches = computed(() => {
    const picked = this.#fields().color;
    return EVENT_COLORS.map((id) => ({
      id,
      value: EVENT_COLOR_VALUES[id],
      key: `calendar.colors.${id}`,
      picked: id === picked,
    }));
  });

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
