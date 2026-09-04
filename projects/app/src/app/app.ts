import { Component, DestroyRef, DOCUMENT, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Viewport } from './viewport';

/** App shell: a top bar (page nav + theme) and the routed page below it.
    Pages own everything inside — their inset, their scrolling, their cards. */
@Component({
  // The shell *is* the <body> (see index.html) — no wrapper element between
  // the viewport and the layout.
  selector: '[app-root]',
  imports: [
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

  /** The top bar's pages, in reading order. */
  protected readonly pages = [
    { path: '/', icon: 'edit_note', label: 'Composer' },
    { path: '/api', icon: 'api', label: 'API' },
    { path: '/styling', icon: 'palette', label: 'Styling' },
  ];

  /** Starts at the system preference; the toggle takes over from there. */
  protected readonly theme = signal<'light' | 'dark'>(
    this.#window?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );

  protected readonly themeLabel = computed(() =>
    this.theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
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

  protected toggleTheme(): void {
    const flip = () => this.theme.update((theme) => (theme === 'light' ? 'dark' : 'light'));
    if (this.#document.startViewTransition) {
      this.#document.startViewTransition(flip);
      return;
    }
    flip();
  }
}
