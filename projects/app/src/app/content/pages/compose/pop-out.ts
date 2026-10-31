import {
  Component,
  DOCUMENT,

  // Signals
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

// Angular Material
import { MatAnchor, MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

import { PopOuts } from '../../../core/email/pop-outs';
import { Compose } from './compose';

/** Where a pop-out stands:
    - `waiting`: for its session — another window has it open, or the tab
      that popped it out is still storing its images;
    - `open`: the message, the session's draft;
    - `missing`: no such session — sent, discarded, taken back into the
      mailbox, or a link from another browser. */
type PopOutState = 'waiting' | 'open' | 'missing';

/** How long a pop-out waits before it says another window has its
    message, ms — a handover is quicker than that. */
const ELSEWHERE_AFTER = 600;

/**
 * A pop-out: the front page's document in a browser window of its own
 * (`/compose/:session`), its message the session's draft (`PopOuts`). It
 * holds the session while it shows it, so the message is open in one
 * place at a time; a session that is not there is an error page, never a
 * new message in its place.
 */
@Component({
  selector: 'app-pop-out',
  imports: [Compose, RouterLink, TranslatePipe, MatAnchor, MatButton, MatIcon],
  templateUrl: './pop-out.html',
  styleUrls: ['./landing.scss', './pop-out.scss'],
})
export class PopOut {
  /** The session, from the URL — the id alone. */
  readonly session = input.required<string>();

  readonly #popOuts = inject(PopOuts);
  readonly #window = inject(DOCUMENT).defaultView;

  protected readonly state = signal<PopOutState>('waiting');

  /** Waiting long enough that another window must have the message. */
  protected readonly elsewhere = signal(false);

  /** A window a script opened can close itself; one opened from its link
      cannot. */
  protected readonly closable = !!this.#window?.opener;

  constructor() {
    effect((onCleanup) => {
      const session = this.session();
      untracked(() => {
        this.state.set('waiting');
        this.elsewhere.set(false);
      });
      const timer = setTimeout(() => this.elsewhere.set(true), ELSEWHERE_AFTER);
      const release = this.#popOuts.attach(session, (found) => {
        clearTimeout(timer);
        this.state.set(found ? 'open' : 'missing');
      });
      onCleanup(() => {
        clearTimeout(timer);
        release();
      });
    });
  }

  protected close(): void {
    this.#window?.close();
  }
}
