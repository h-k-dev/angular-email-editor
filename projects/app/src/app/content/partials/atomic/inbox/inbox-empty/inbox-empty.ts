import { Component } from '@angular/core';

// Angular Material
import { MatIcon } from '@angular/material/icon';

import { TranslatePipe } from '@ngx-translate/core';

/** The inbox's pane while no message is open (`/inbox`): on a desk, a
    quiet note where the message will be; a phone shows the list alone. */
@Component({
  selector: 'app-inbox-empty',
  imports: [TranslatePipe, MatIcon],
  template: `
    <mat-icon class="inbox-empty__icon">mail</mat-icon>
    <p class="inbox-empty__text">{{ 'inbox.empty' | translate }}</p>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      block-size: 100%;
      color: var(--mat-sys-on-surface-variant);
    }

    .inbox-empty__icon {
      --mat-icon-size: 32px;
      inline-size: 32px;
      block-size: 32px;
      color: var(--mat-sys-placeholder);
    }

    .inbox-empty__text {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class InboxEmpty {}
