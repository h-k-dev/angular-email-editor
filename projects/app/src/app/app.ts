import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ComposeWindows } from '../services/compose-windows';
import { I18n } from '../services/i18n';
import { LanguageMenu } from './language-menu/language-menu';
import { Theme } from '../services/theme';
import { Viewport } from '../services/viewport';

/** App shell: a top bar (page nav, Compose, language, theme) and the routed page below it.
    Pages own everything inside — their inset, their scrolling, their cards. */
@Component({
  // The shell *is* the <body> (see index.html) — no wrapper element between
  // the viewport and the layout.
  selector: '[app-root]',
  imports: [
    LanguageMenu,
    MatButtonModule,
    MatIconModule,
    MatToolbarModule,
    RouterLink,
    RouterLinkActive,
    RouterOutlet,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '[class.dark-mode]': "theme() === 'dark'",
    // The virtual keyboard's cover, for the shell's height (app.scss).
    '[style.--keyboard-inset.px]': 'viewport.keyboardInset()',
  },
})
export class App {
  protected readonly viewport = inject(Viewport);
  protected readonly i18n = inject(I18n);
  readonly #composeWindows = inject(ComposeWindows);

  /** The top bar's pages, in reading order. */
  protected readonly pages = [
    { path: '/', icon: 'edit_note', key: 'app.nav.composer', label: 'Composer' },
    { path: '/api', icon: 'api', key: 'app.nav.api', label: 'API' },
    { path: '/styling', icon: 'palette', key: 'app.nav.styling', label: 'Styling' },
    { path: '/render', icon: 'compare', key: 'app.nav.render', label: 'Render' },
  ];

  readonly #theme = inject(Theme);

  /** The app's light or dark (the `Theme` service): the system preference,
      until the toggle takes over. */
  protected readonly theme = this.#theme.scheme;

  protected readonly themeLabel = computed(() =>
    this.theme() === 'dark'
      ? this.i18n.t('app.theme.light', 'Switch to light mode')
      : this.i18n.t('app.theme.dark', 'Switch to dark mode'),
  );

  constructor() {
    // Self-hosted Material Symbols (public/sass/font): mat-icon defaults to
    // the classic 'material-icons' ligature class; point every icon at the
    // new font's class instead.
    inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
  }

  /** Compose: a new message in a window, whatever page is open. */
  protected compose(): void {
    void this.#composeWindows.open();
  }

  protected toggleTheme(): void {
    this.#theme.toggle();
  }
}
