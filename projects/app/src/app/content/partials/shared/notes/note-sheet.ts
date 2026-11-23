import { Component, computed, inject, input } from '@angular/core';

import { TranslatePipe } from '@ngx-translate/core';

import { Notes } from '../../../../core/notes/notes';

/**
 * A note's content, for the window that holds it (`ComposeWindowFrame`,
 * kind `note`) — what a message form is to a message's window: the text,
 * and nothing of the frame. The caret starts in it (`cdkFocusInitial`, the
 * window's focus trap's).
 */
@Component({
  selector: 'div[note-sheet]',
  imports: [TranslatePipe],
  template: `
    <textarea
      class="note-sheet__text"
      cdkFocusInitial
      [attr.aria-label]="'notes.text' | translate"
      [placeholder]="'notes.placeholder' | translate"
      [value]="text()"
      (input)="notes.write(note(), $any($event.target).value)"
    ></textarea>
  `,
  styles: `
    :host {
      display: flex;
      min-block-size: 0;
    }

    .note-sheet__text {
      flex: 1 1 auto;
      min-block-size: 0;
      padding: 8px 16px 16px;
      border: none;
      outline: none;
      resize: none;
      background: none;
      color: inherit;
      font: var(--mat-sys-body-large);
    }
  `,
})
export class NoteSheet {
  protected readonly notes = inject(Notes);

  /** The note's id. */
  readonly note = input.required<number>();

  protected readonly text = computed(() => this.notes.find(this.note())?.text ?? '');
}
