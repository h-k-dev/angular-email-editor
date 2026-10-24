import { Component, computed, inject } from '@angular/core';

// Angular Material
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';

import { I18n } from '../../../../core/translations/i18n';
import { Theme } from '../../../../core/theme/theme';

/**
 * The app's light or dark (the `Theme` service): one icon button, showing
 * the scheme a press switches to. Wherever a page keeps its settings — the
 * landing's top bar, the mailbox's aside foot.
 */
@Component({
  selector: 'theme-toggle',
  imports: [MatIconButton, MatIcon],
  template: `
    <button matIconButton type="button" [attr.aria-label]="label()" [title]="label()" (click)="toggle()">
      <mat-icon>{{ scheme() === 'dark' ? 'light_mode' : 'dark_mode' }}</mat-icon>
    </button>
  `,
  // No box of its own: the button is the bar's or the foot's item.
  styles: ':host { display: contents; }',
})
export class ThemeToggle {
  readonly #theme = inject(Theme);
  readonly #i18n = inject(I18n);

  /** The system preference, until the toggle takes over. */
  protected readonly scheme = this.#theme.scheme;

  protected readonly label = computed(() =>
    this.scheme() === 'dark' ? this.#i18n.t('app.theme.light') : this.#i18n.t('app.theme.dark'),
  );

  protected toggle(): void {
    this.#theme.toggle();
  }
}
