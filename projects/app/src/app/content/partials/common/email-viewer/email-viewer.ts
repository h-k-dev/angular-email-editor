import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Angular Email Editor
import { injectPalette } from '@h-k-dev/angular-email-editor/palette';

import { PaperScheme, readingDocument } from '../../../../core/render/render';
import { Paper } from '../../../../core/theme/paper';

/**
 * An email, shown as a client shows it: a frame drawing `readingDocument`
 * (core/render — Apple Mail's rendering, the email's own dark-mode rules,
 * on the editor's paper), with no scripts and its links out to a tab of
 * their own, as tall as what it holds — so the page round it scrolls as
 * one, and the frame never shows a scrollbar of its own.
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
  readonly #palette = injectPalette();
  readonly #paper = inject(Paper).scheme;

  /** The email: a fragment or a whole document. */
  readonly html = input.required<string>();

  /** Light or dark paper; the editor's own when not given. */
  readonly scheme = input<PaperScheme | null>(null);

  /** What the frame is, for assistive tech. */
  readonly label = input('');

  /** The document for the frame — a frame with no scripts, so passing the
      sanitizer by is safe here, as the compose preview's is. */
  protected readonly document = computed<SafeHtml>(() =>
    this.#sanitizer.bypassSecurityTrustHtml(
      readingDocument(this.html(), {
        scheme: this.scheme() ?? this.#paper(),
        darkMode: this.#palette,
      }),
    ),
  );

  /** The frame's height: its document's. */
  protected readonly height = signal(0);
  #observer: ResizeObserver | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.#observer?.disconnect());
  }

  /** The frame has drawn its document (again, after a change): fit it, and
      keep fitting it as its width reflows the email. */
  protected fit(frame: HTMLIFrameElement): void {
    this.#observer?.disconnect();
    const root = frame.contentDocument?.documentElement;
    if (!root) return;
    const measure = () => this.height.set(Math.ceil(root.getBoundingClientRect().height));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    this.#observer = new ResizeObserver(measure);
    this.#observer.observe(root);
  }
}
