import { Component, DestroyRef, DOCUMENT, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ComposeWindows } from '../services/compose-windows';
import { I18n } from '../services/i18n';
import { LanguageMenu } from './language-menu/language-menu';
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
  readonly #document = inject(DOCUMENT);
  readonly #window = this.#document.defaultView;
  readonly #destroyRef = inject(DestroyRef);
  protected readonly viewport = inject(Viewport);
  protected readonly i18n = inject(I18n);
  readonly #composeWindows = inject(ComposeWindows);

  /** The top bar's pages, in reading order. */
  protected readonly pages = [
    { path: '/', icon: 'edit_note', key: 'app.nav.composer', label: 'Composer' },
    { path: '/api', icon: 'api', key: 'app.nav.api', label: 'API' },
    { path: '/styling', icon: 'palette', key: 'app.nav.styling', label: 'Styling' },
  ];

  /** Starts at the system preference; the toggle takes over from there. */
  protected readonly theme = signal<'light' | 'dark'>(
    this.#window?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

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

    // Follow the OS while the user has not chosen — a toggle overrides the
    // signal, and the next OS change overrides it back, which is what a demo
    // shell should do (nothing here is persisted).
    const query = this.#window?.matchMedia?.('(prefers-color-scheme: dark)');
    if (query) {
      const onChange = (event: MediaQueryListEvent) =>
        this.theme.set(event.matches ? 'dark' : 'light');
      query.addEventListener('change', onChange);
      this.#destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }
  }

  /** Compose: a new message in a window, whatever page is open. */
  protected compose(): void {
    void this.#composeWindows.open();
  }

  protected toggleTheme(): void {
    const flip = () => this.theme.update((theme) => (theme === 'light' ? 'dark' : 'light'));
    if (this.#document.startViewTransition) {
      this.#document.startViewTransition(flip);
      return;
    }
    flip();
  }
}
