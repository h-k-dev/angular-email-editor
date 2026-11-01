import { Component, ElementRef, ViewEncapsulation, effect, inject, input } from '@angular/core';
import { DOMSerializer } from 'prosemirror-model';

import { noteDoc, noteSchema } from './note-schema';

const toDom = DOMSerializer.fromSchema(noteSchema);

/**
 * A note, read: its Markdown as `note-editor` shows it — the same schema
 * drawn by the same rules, so a note looks the same written and read.
 * Built as nodes from the schema, never `innerHTML`: what Markdown says
 * beyond the schema (HTML, a `javascript:` link) is words or nothing.
 *
 *     <note-view [note]="event.description" />
 */
@Component({
  selector: 'note-view',
  template: '',
  styleUrl: './note-editor.scss',
  encapsulation: ViewEncapsulation.None,
  host: { class: 'note-editor__text' },
})
export class NoteView {
  readonly note = input.required<string>();

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    effect(() => host.replaceChildren(toDom.serializeFragment(noteDoc(this.note()).content)));
  }
}
