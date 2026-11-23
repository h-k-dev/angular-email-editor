import { Component, computed, inject, input } from '@angular/core';

import { MatButton } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe } from '@ngx-translate/core';

import { EventDraft, EventDrafts } from '../../../../core/calendar/event-drafts';
import { I18n } from '../../../../core/translations/i18n';

/**
 * An event draft's content, for the window that holds it
 * (`ComposeWindowFrame`, kind `event`) — what a message form is to a
 * message's window: a few rows (what, from when to when, where) and Save,
 * and nothing of the frame. The caret starts in the title
 * (`cdkFocusInitial`, the window's focus trap's).
 */
@Component({
  selector: 'form[event-sheet]',
  imports: [TranslatePipe, MatButton],
  templateUrl: './event-sheet.html',
  styleUrl: './event-sheet.scss',
  host: {
    '(submit)': 'save($event)',
  },
})
export class EventSheet {
  protected readonly drafts = inject(EventDrafts);
  readonly #snackBar = inject(MatSnackBar);
  readonly #i18n = inject(I18n);

  /** The draft's id. */
  readonly event = input.required<number>();

  protected readonly draft = computed(() => this.drafts.find(this.event()));

  protected write(field: keyof Omit<EventDraft, 'id'>, event: Event): void {
    this.drafts.write(this.event(), { [field]: (event.target as HTMLInputElement).value });
  }

  /** Into the calendar; the window closes, and says so. */
  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (await this.drafts.save(this.event())) {
      this.#snackBar.open(this.#i18n.t('eventDraft.saved'), undefined, { duration: 4000 });
    }
  }
}
