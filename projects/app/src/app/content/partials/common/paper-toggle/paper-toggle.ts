import { Component, computed, inject } from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

import { I18n } from '../../../../core/translations/i18n';
import { Paper } from '../../../../core/theme/paper';

/**
 * The email's light or dark (the `Paper` service — the settings' Theme),
 * ThemeToggle's sibling for the paper: one icon button, showing the paper
 * a press switches to. In a bar over an email — the designer's — to see the
 * other side of it at once.
 */
@Component({
  selector: 'paper-toggle',
  imports: [MatIconButton, MatIcon, MatTooltip],
  template: `
    <button
      matIconButton
      type="button"
      [attr.aria-label]="label()"
      [matTooltip]="label()"
      matTooltipPosition="below"
      (click)="toggle()"
    >
      <mat-icon>{{ scheme() === 'dark' ? 'light_mode' : 'dark_mode' }}</mat-icon>
    </button>
  `,
  // No box of its own: the button is the bar's item.
  styles: ':host { display: contents; }',
})
export class PaperToggle {
  readonly #paper = inject(Paper);
  readonly #i18n = inject(I18n);

  protected readonly scheme = this.#paper.scheme;

  protected readonly label = computed(() =>
    this.scheme() === 'dark' ? this.#i18n.t('app.paper.light') : this.#i18n.t('app.paper.dark'),
  );

  protected toggle(): void {
    this.#paper.toggle();
  }
}
