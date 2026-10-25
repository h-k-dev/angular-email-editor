import { Component, input } from '@angular/core';

// Angular Material
import { MatIcon } from '@angular/material/icon';

import { FloatingScrollbar } from '../../../../core/common/directives/floating-scrollbar/floating-scrollbar';

/** What the phone shows round its content: nothing but the status bar, or
    a mobile browser's bars (Brave's — the address on top, the toolbar at
    the foot). */
export type PhoneChrome = 'none' | 'browser';

/**
 * A phone, drawn: a bezel round a screen exactly `width` px wide (375 — the
 * narrowest phone a message is still read on, an iPhone mini's), its status
 * bar on top with the dynamic island in it. What is projected is the
 * screen's content and scrolls inside it, under a bar that floats as a
 * phone's does. The frame is as tall as its box lets it be, up to the
 * phone's own 812px of screen: what matters is the width an email is laid
 * out at, never a squeezed one.
 *
 * As a browser (`chrome="browser"`), the screen is Brave's on a phone: the
 * address bar under the status bar — the page's host, its padlock, the
 * shields — and the toolbar at the foot (back, forward, new tab, tabs,
 * menu) over the home indicator; the content scrolls between the two. All
 * drawn: nothing in them presses.
 *
 *     <phone-frame chrome="browser" url="mail.example.com" label="Phone preview">…</phone-frame>
 *
 * An element marked `phoneOverlay` is laid over the page instead, still
 * while the page scrolls under it — a control on the screen, not of the
 * page (the template designer's light / dark divider). It places itself:
 * the page between the bars is its box.
 *
 * The page wears the paper (`--email-paper`) of the island it sits on; the
 * bars the island's surface, light or dark with it.
 */
@Component({
  selector: 'phone-frame',
  imports: [MatIcon, FloatingScrollbar],
  templateUrl: './phone-frame.html',
  styleUrl: './phone-frame.scss',
  host: {
    '[style.--phone-frame-width.px]': 'width()',
    '[attr.data-chrome]': 'chrome()',
  },
})
export class PhoneFrame {
  /** The screen's width, px: what the content is laid out at. */
  readonly width = input(375);

  /** The bars round the content. */
  readonly chrome = input<PhoneChrome>('none');

  /** The host the browser's address bar shows. */
  readonly url = input('');

  /** What the screen shows, for assistive tech — it scrolls, so it is a
      stop of its own for the keyboard. */
  readonly label = input('');
}
