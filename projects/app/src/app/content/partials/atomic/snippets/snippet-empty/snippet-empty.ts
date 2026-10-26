import { Component } from '@angular/core';

// Angular Material
import { MatIcon } from '@angular/material/icon';

import { TranslatePipe } from '@ngx-translate/core';

import { PageHeader } from '../../../common/page-header/page-header';

/** The snippets' pane while none is open (`/snippets`): on a desk, a quiet
    note where the snippet will be, under an empty header level with the
    list's; a phone shows the list alone. */
@Component({
  selector: 'app-snippet-empty',
  imports: [TranslatePipe, MatIcon, PageHeader],
  template: `
    <header page-header [frameLead]="false"></header>
    <div class="snippet-empty">
      <mat-icon class="snippet-empty__icon">short_text</mat-icon>
      <p class="snippet-empty__text">{{ 'snippets.empty' | translate }}</p>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
    }

    .snippet-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      color: var(--mat-sys-on-surface-variant);
    }

    .snippet-empty__icon {
      --mat-icon-size: 32px;
      inline-size: 32px;
      block-size: 32px;
      font-size: 32px;
      color: var(--mat-sys-placeholder);
    }

    .snippet-empty__text {
      margin: 0;
      font: var(--mat-sys-body-medium);
    }
  `,
})
export class SnippetEmpty {}
