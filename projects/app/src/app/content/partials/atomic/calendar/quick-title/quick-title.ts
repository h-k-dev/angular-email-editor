import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormField, FormRoot, form } from '@angular/forms/signals';

import { TranslatePipe } from '@ngx-translate/core';

import { EventEdit } from '../../../../../core/calendar/calendar-event';
import { HeightSwitch } from '../../../../../core/directives/height-switch/height-switch';
import { NoteEditor } from '../../../common/note-editor/note-editor';

/**
 * A new event, named: the title and nothing else — no colour, no close, no
 * frame. It is the grid's own ground with the grid's lines gone, so it is
 * seen only by that and its placeholder. Enter keeps the event; Escape and
 * a press away are the page's (it holds the overlay).
 *
 * Shift+Enter in the title brings out a description under it, its height
 * run (`heightSwitch`): a Markdown note — lists, bold, italic, strike,
 * code and links (`note-editor`). There, Enter is a new line and Mod-Enter keeps the
 * event, as an email's Send; Backspace in the empty note puts it away,
 * back to the title.
 *
 * The edit is a two-way `value`, written through as it is typed, as the
 * full card's (`EventEdit`) — the mark in the grid says the title at once.
 * Title and note are one signal form over it; keeping the event is its
 * submit.
 */
@Component({
  selector: 'calendar-quick-title',
  imports: [FormField, FormRoot, HeightSwitch, NoteEditor, TranslatePipe],
  templateUrl: './quick-title.html',
  styleUrl: './quick-title.scss',
})
export class QuickTitle {
  readonly #injector = inject(Injector);

  readonly value = model.required<EventEdit>();

  readonly save = output<EventEdit>();

  protected readonly quick = form(this.value, {
    name: 'quick-event',
    submission: {
      action: async () => {
        this.save.emit(this.value());
        return undefined;
      },
    },
  });

  private readonly titleInput = viewChild.required<ElementRef<HTMLInputElement>>('title');
  private readonly note = viewChild(NoteEditor);

  /** Shift+Enter pressed in the title. */
  readonly #noteAsked = signal(false);
  /** The description: out once asked for, or while it holds something. */
  protected readonly noteShown = computed(() => this.#noteAsked() || !!this.value().description);

  constructor() {
    afterNextRender(() => this.focus());
  }

  /** Back in the title — after the next mark, pressed on the grid. */
  focus(): void {
    this.titleInput().nativeElement.focus({ preventScroll: true });
  }

  /** Shift+Enter in the title: the description out, the caret in it —
      never the form sent. */
  protected openNote(event: Event): void {
    event.preventDefault();
    this.#noteAsked.set(true);
    afterNextRender(() => this.note()?.focus(), { injector: this.#injector });
  }

  /** Backspace in the empty description: put away, the caret back at the
      title's end. */
  protected closeNote(): void {
    this.#noteAsked.set(false);
    const title = this.titleInput().nativeElement;
    title.focus({ preventScroll: true });
    title.setSelectionRange(title.value.length, title.value.length);
  }
}
