import { Component, inject } from '@angular/core';

import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

import { Notes } from '../../../../core/notes/notes';

/**
 * The notes' page: every note of the session, and where each is — open in
 * a window on the edge, minimized onto the dock's stack, or closed. A row
 * opens its note; the button adds one.
 */
@Component({
  selector: 'section[notes-page]',
  imports: [TranslatePipe, MatIconButton, MatIcon],
  templateUrl: './notes.html',
  styleUrl: './notes.scss',
})
export class NotesPage {
  protected readonly notes = inject(Notes);
}
