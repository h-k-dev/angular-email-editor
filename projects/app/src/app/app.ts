import { Component, DestroyRef, Injector, inject } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { RouterOutlet } from '@angular/router';
import { Theme } from './core/theme/theme';
import { Viewport } from './core/layout/viewport';

/** App shell: the routed page on the whole viewport. No chrome of its own
    — the landing draws its top bar, the mailbox its aside and a phone's
    floating Compose; neither lays out the other. Pages own everything
    inside — their inset, their scrolling, their cards. */
@Component({
  // The shell *is* the <body> (see index.html) — no wrapper element between
  // the viewport and the layout.
  selector: '[app-root]',
  imports: [RouterOutlet],
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

  /** The app's light or dark (the `Theme` service): the system preference,
      until a page's toggle takes over. */
  protected readonly theme = inject(Theme).scheme;

  constructor() {
    // Self-hosted Material Symbols (public/sass/font): mat-icon defaults to
    // the classic 'material-icons' ligature class; point every icon at the
    // new font's class instead.
    inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');

    // Every tab hears the pop-outs from the start: whichever page it shows,
    // it may be the one a pop-out hands its message back to. A chunk of its
    // own, so the shell's stays the outlet. The chunk may land after the
    // shell is gone (a test's teardown) — then there is no one to hear.
    const injector = inject(Injector);
    const destroyRef = inject(DestroyRef);
    void import('./core/email/pop-outs').then(({ PopOuts }) => {
      if (!destroyRef.destroyed) injector.get(PopOuts);
    });
  }
}
