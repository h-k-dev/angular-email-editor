import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { PaperScheme, dawnDocument } from '../../../../core/dawn/dawn.render';
import { Paper } from '../../../../core/theme/paper';

/**
 * An email, shown as a client shows it: a frame drawing `dawnDocument`
 * (core/dawn — its dark mode dawn dark: the email's own dark rules, or
 * the invert-lightness turn; on the editor's paper), with no
 * scripts and its links out to a tab of their own, as tall as what it
 * holds — so the page round it scrolls as one, and the frame never shows a
 * scrollbar of its own. An email wider than the room (a fixed-width table,
 * a wide image) widens the frame to it — never clipped, never squeezed —
 * and so the box round it: whatever scrolls the page scrolls it sideways
 * too, one scroller both ways.
 *
 *     <email-viewer [html]="mail.html" label="Message" />
 *
 * The paper follows the editor's (`Paper`) unless `scheme` says otherwise.
 * Takes a fragment (a body) or a whole document (a newsletter).
 */
@Component({
  selector: 'email-viewer',
  template: `
    <iframe
      #frame
      class="email-viewer__frame"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      [title]="label()"
      [srcdoc]="document()"
      [style.block-size.px]="height()"
      [style.min-inline-size.px]="width() || null"
      (load)="fit(frame)"
    ></iframe>
  `,
  styles: `
    :host {
      display: block;
    }

    // No edge of its own: its document is the paper the page round it is.
    .email-viewer__frame {
      display: block;
      inline-size: 100%;
      border: 0;
      background: var(--email-paper, transparent);
    }
  `,
})
export class EmailViewer {
  readonly #sanitizer = inject(DomSanitizer);
  readonly #paper = inject(Paper).scheme;

  /** The email: a fragment or a whole document. */
  readonly html = input.required<string>();

  /** Light or dark paper; the editor's own when not given. */
  readonly scheme = input<PaperScheme | null>(null);

  /** What the frame is, for assistive tech. */
  readonly label = input('');

  /** The side inset a simple email's text keeps inside the frame, px — to
      line it up with what stands over it. A newsletter runs edge to edge
      regardless (`dawnDocument`). */
  readonly inset = input(0);

  /** The document for the frame — a frame with no scripts, so passing the
      sanitizer by is safe here, as the compose preview's is. */
  protected readonly document = computed<SafeHtml>(() =>
    this.#sanitizer.bypassSecurityTrustHtml(
      dawnDocument(this.html(), {
        scheme: this.scheme() ?? this.#paper(),
        inset: this.inset(),
      }),
    ),
  );

  /** The frame's height: its document's. */
  protected readonly height = signal(0);
  #observer: ResizeObserver | null = null;

  /** How wide the email is where it is wider than the room it was given,
      px — the frame's least width; 0 where it fits (a responsive email
      always does). */
  protected readonly width = signal(0);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.#observer?.disconnect());
  }

  /** The frame has drawn its document (again, after a change): fit it, and
      keep fitting it as its width reflows the email. */
  protected fit(frame: HTMLIFrameElement): void {
    this.#observer?.disconnect();
    this.width.set(0);
    const root = frame.contentDocument?.documentElement;
    if (!root) return;
    // The frame is as big as its email both ways: its document never
    // scrolls. Left to itself, an email that just fills the frame keeps a
    // classic bar each way — each one's room making the other overflow.
    root.style.overflow = 'hidden';
    // Only an overflow says how wide the email is: one that fits fills the
    // frame, whatever its own width. Read once, as it is drawn — widened to
    // it the email fits, and that width holds until the next document (a
    // width set from the observer would resize what it observes, a loop).
    if (root.scrollWidth > root.clientWidth) this.width.set(root.scrollWidth);
    const measure = () => this.height.set(Math.ceil(root.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    this.#observer = new ResizeObserver(measure);
    this.#observer.observe(root);
  }
}
