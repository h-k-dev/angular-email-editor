import {
  Component,
  inject,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  linkedSignal,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, FormRoot, form, validate } from '@angular/forms/signals';
import { DateTime } from 'luxon';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

import { TranslatePipe } from '@ngx-translate/core';

import { mapsUrl } from '../../../../../core/calendar/maps';
import { DateField } from '../../../common/date-field/date-field';
import { HoverCard } from '../../../common/hover-card/hover-card';
import { NoteEditor } from '../../../common/note-editor/note-editor';
import { ColorMarker } from '../../../shared/calendar/color-marker/color-marker';
import { QuietField } from '../../../common/quiet-field/quiet-field';
import { ToggleSwitch } from '../../../common/toggle-switch/toggle-switch';
import { HeightSwitch } from '../../../../../core/directives/height-switch/height-switch';
import { ZonePicker } from '../zone-picker/zone-picker';
import { localZone } from '../../../../../core/calendar/time-zones';

import {
  daysBetween,
  isoDay,
  isoMoment,
  parseDay,
  parseMoment,
} from '../../../../../core/calendar/calendar-dates';
import {
  DEFAULT_EVENT_MINUTES,
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
  /** The zone the times are typed in, an IANA name — the event's own, else
      the browser's. */
  timeZone: string;
}

function toFields(edit: EventEdit): EditorFields {
  const timeZone = edit.timeZone ?? localZone();
  const span = eventSpan(edit);
  // A timed event's hours as they are in its zone; a day is a day anywhere.
  const [start, end] = edit.allDay
    ? [span.start, span.end]
    : [span.start.setZone(timeZone), span.end.setZone(timeZone)];
  const last = edit.allDay ? end.minus({ days: 1 }) : end;
  return {
    timeZone,
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
    // Kept only once it is not simply the browser's.
    ...(previous.timeZone || fields.timeZone !== localZone() ? { timeZone: fields.timeZone } : {}),
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
  // The hours typed are the zone's; stored as the browser's.
  const start = parseMoment(`${fields.startDay}T${fields.startTime}`, fields.timeZone);
  const end = parseMoment(`${fields.endDay}T${fields.endTime}`, fields.timeZone);
  if (!start || !end) return base;
  return { ...base, start: isoMoment(start.toLocal()), end: isoMoment(end.toLocal()) };
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

/** All day turned off on a day with no times of its own: a timed event at
    nine, as long as Google's. */
function timedAgain(before: EditorFields, after: EditorFields): EditorFields {
  if (after.allDay || !before.allDay) return after;
  if (after.startTime !== '00:00' || after.endTime !== '00:00') return after;
  const start = parseDay(after.startDay)?.set({ hour: 9 });
  if (!start) return after;
  return {
    ...after,
    startTime: start.toFormat('HH:mm'),
    endDay: after.startDay,
    endTime: start.plus({ minutes: DEFAULT_EVENT_MINUTES }).toFormat('HH:mm'),
  };
}

/** The sections behind their buttons, in their slots' order. */
type Section = 'place' | 'note';
const SECTIONS: readonly Section[] = ['place', 'note'];

const sameEdit = (a: EventEdit, b: EventEdit): boolean =>
  (Object.keys(b) as (keyof EventEdit)[]).every((key) => a[key] === b[key]);

/**
 * An event, written: Notion Calendar's card — the title large on top, when
 * it starts and ends, all day or not, its zone, its colour, where, and a
 * note; Delete and close in its bar, Save at the foot of the column under
 * close. The card is the page's to place (beside the event, in an
 * overlay); this is what is in it.
 *
 * The edit is a two-way `value`, written through as it is typed: the grids
 * show the event where it will be while the card is open, and the page
 * only stores it on `save` — Save, or Enter in the title. The fields are
 * one signal form, Save its submit; an end before the start does not go
 * through.
 */
@Component({
  selector: 'calendar-event-editor',
  imports: [
    DateField,
    ColorMarker,
    FormRoot,
    FormField,
    HeightSwitch,
    HoverCard,
    MatIconButton,
    MatIcon,
    MatTooltip,
    NoteEditor,
    QuietField,
    ToggleSwitch,
    TranslatePipe,
    ZonePicker,
  ],
  templateUrl: './event-editor.html',
  styleUrl: './event-editor.scss',
})
export class EventEditor {
  readonly #injector = inject(Injector);

  readonly value = model.required<EventEdit>();

  /** The event to be stored — Save, or Enter in the title; only ever a
      valid one. */
  readonly save = output<EventEdit>();
  /** The bar's Delete: the page lets a new event go, deletes a kept one. */
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
    // A start moved carries the end along (`keepLength`); all day turned
    // off gives a bare day its hours (`timedAgain`).
    set: (fields, rawSet) => {
      const before = this.#fields();
      const kept = timedAgain(before, keepLength(before, fields));
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

  /** The event's colour, as written (`calendar-color-marker`). */
  protected readonly colorId = computed(() => this.#fields().color);

  /** Where the place is on Google Maps — none for no place — and the card
      with the way there: only while the place is typed in. */
  protected readonly mapsLink = computed(() => mapsUrl(this.#fields().location));
  protected readonly placeTyping = signal(false);
  protected readonly placeCardOff = computed(() => !this.placeTyping() || !this.mapsLink());

  /** The zone the times are typed in (`calendar-zone-picker`), and when the
      event starts — the day its offsets are taken on. */
  protected readonly timeZone = computed(() => this.#fields().timeZone);

  /** Whether the band under the times was pressed. */
  readonly #whenAsked = signal(false);
  /** The rows under the times (all day, the zone), Notion's: out once the
      band is pressed — or from the start for an event already all day, or
      in a zone not the browser's, so what it is can be seen and undone. */
  protected readonly whenRows = computed(
    () => this.#whenAsked() || this.allDay() || this.timeZone() !== localZone(),
  );
  protected readonly startsAt = computed(() => parseMoment(this.value().start) ?? DateTime.local());

  constructor() {
    afterNextRender(() => this.titleInput().nativeElement.focus());
  }

  /** The band pressed: all day and the zone out, the band gone. */
  protected showWhenRows(): void {
    this.#whenAsked.set(true);
  }

  /** The sections brought out by their buttons, in the order they were. */
  readonly #opened = signal<readonly Section[]>([]);
  /** The place and the note: out once their button is pressed, or while
      they hold something. */
  protected readonly placeShown = computed(
    () => this.#opened().includes('place') || !!this.#fields().location.trim(),
  );
  protected readonly noteShown = computed(
    () => this.#opened().includes('note') || !!this.#fields().description,
  );
  /** The sections out, top down: the ones held from the start (place,
      then note), then each brought out under the last — added at the
      bottom, nothing above moving. */
  protected readonly sections = computed<readonly Section[]>(() => {
    const opened = this.#opened();
    const shown = (one: Section) => (one === 'place' ? this.placeShown() : this.noteShown());
    const held = SECTIONS.filter((one) => shown(one) && !opened.includes(one));
    return [...held, ...opened.filter(shown)];
  });

  /** What the fields' height switches on (`heightSwitch`): which rows are
      out. */
  protected readonly look = computed(
    () => `${this.whenRows()} ${this.allDay()} ${this.sections().join()}`,
  );

  private readonly placeInput = viewChild<ElementRef<HTMLInputElement>>('place');
  private readonly noteEditor = viewChild(NoteEditor);

  /** A section's button: the section out at the bottom, to be typed in. */
  protected showPlace(): void {
    this.#open('place');
    afterNextRender(() => this.placeInput()?.nativeElement.focus(), { injector: this.#injector });
  }

  protected showNote(): void {
    this.#open('note');
    afterNextRender(() => this.noteEditor()?.focus(), { injector: this.#injector });
  }

  /** Left empty: put away again, its button back in its slot. */
  protected placeLeft(): void {
    this.placeTyping.set(false);
    if (!this.#fields().location.trim()) this.#close('place');
  }

  protected noteLeft(): void {
    if (!this.#fields().description) this.#close('note');
  }

  /** Backspace in the empty note: put away, the caret back in the title. */
  protected putNoteAway(): void {
    this.#close('note');
    this.titleInput().nativeElement.focus();
  }

  #open(section: Section): void {
    this.#opened.update((opened) => (opened.includes(section) ? opened : [...opened, section]));
  }

  #close(section: Section): void {
    this.#opened.update((opened) => opened.filter((one) => one !== section));
  }

  protected pickColor(color: EventColor): void {
    this.editor.color().value.set(color);
  }

  /** Another zone: the times keep their hours, now that zone's — the event
      moves in the calendar, Google's. */
  protected pickZone(zone: string): void {
    this.editor.timeZone().value.set(zone);
  }
}
