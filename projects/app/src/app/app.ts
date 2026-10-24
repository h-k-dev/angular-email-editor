import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ComposeWindows } from '../services/compose-windows';
import { Theme } from '../services/theme';
import { Viewport } from '../services/viewport';

/** App shell: the routed page on the whole viewport, and a phone's floating
    Compose over it. No chrome of its own — the landing draws its top bar,
    the mailbox its aside; neither lays out the other. Pages own everything
    inside — their inset, their scrolling, their cards. */
@Component({
  // The shell *is* the <body> (see index.html) — no wrapper element between
  // the viewport and the layout.
  selector: '[app-root]',
  imports: [TranslatePipe, MatButtonModule, MatIconModule, RouterOutlet],
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
  readonly #composeWindows = inject(ComposeWindows);

  /** The app's light or dark (the `Theme` service): the system preference,
      until a page's toggle takes over. */
  protected readonly theme = inject(Theme).scheme;

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
}
