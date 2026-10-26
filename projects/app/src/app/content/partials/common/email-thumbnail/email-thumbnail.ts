import { Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Library
import { hasDocumentEnvelope, pendingImageSource } from '@h-k-dev/angular-email-editor';

import { PaperScheme, dawnDocument } from '../../../../core/dawn/dawn.render';
import { Paper } from '../../../../core/theme/paper';
import { GridIsland } from '../virtual-grid/virtual-grid';

/** The width an email is designed for, px: the thumbnail draws it at this
    width and shrinks the drawing, so it lays out as a client lays it out. */
const EMAIL_WIDTH = 600;

/** Drawn into the thumbnail's frame: it never scrolls, never shows a bar. */
const STILL = '<style>html, body { overflow: hidden !important; scrollbar-width: none; }</style>';

/** A simple email's margin round its text, px at the email's own width — a
    letter on a page, as the reader sets it under its header. A newsletter
    runs edge to edge, as it is designed to. */
const MARGIN = 32;
const LETTER = `<style>body { padding-block-start: ${MARGIN}px; }</style>`;

/** The image placeholder's frame, as the editor draws it, in the email's own
    ink (`currentColor`), so it reads on light paper and dark alike. */
const FRAME_STYLE =
  'display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; ' +
  'width: 100%; aspect-ratio: 4 / 3; vertical-align: middle; overflow: visible; ' +
  'border: 2px dashed color-mix(in srgb, currentColor 30%, transparent); border-radius: 8px; ' +
  'font: 12px/1.4 sans-serif; white-space: nowrap;';
const TOKEN_STYLE =
  'padding: 1px 4px; border-radius: 4px; ' +
  'background-color: color-mix(in srgb, currentColor 12%, transparent);';

/**
 * Every image whose source is still a token (`src="{{ company.logoUrl }}"`,
 * `pendingImageSource`) drawn as the editor's placeholder — the frame at the
 * image's width, the expression dead centre — instead of the browser's
 * broken icon: a template is shown before its tags are filled. Only those
 * `<img>` tags change; the rest of the email is kept as written.
 */
export function framePendingImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    const source = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const pending = pendingImageSource(source?.[1] ?? source?.[2]);
    if (!pending) return tag;
    const width = /\swidth\s*=\s*["']?(\d+)/i.exec(tag)?.[1];
    const max = width ? ` max-width: ${width}px;` : '';
    const text = pending.replaceAll('<', '&lt;');
    return `<span style="${FRAME_STYLE}${max}"><span style="${TOKEN_STYLE}">${text}</span></span>`;
  });
}

/**
 * An email in small, the top of it as a client draws it (`dawnDocument`, on
 * the editor's paper unless `scheme` says otherwise): laid out at its own
 * 600px, then shrunk to the thumbnail's width — never grown past it: in a
 * wider thumbnail it keeps its 600px, centred on its paper, as a client on a
 * wide screen shows it. A picture, not a page: no
 * scripts, nothing to press, nothing to focus, out of assistive tech's way
 * (what it shows is the card's title's to say).
 *
 *     <email-thumbnail [html]="template.html" />
 *
 * In a grid it takes its width from the grid's island (`GridIsland`), so no
 * thumbnail measures itself; it fades in once its drawing has loaded.
 */
@Component({
  selector: 'email-thumbnail',
  template: `
    <iframe
      class="email-thumbnail__frame"
      sandbox=""
      inert
      tabindex="-1"
      aria-hidden="true"
      [srcdoc]="document()"
      [style.block-size.px]="frameHeight()"
      [style.inset-inline-start.px]="offset()"
      [style.scale]="scale()"
      (load)="loaded.set(true)"
    ></iframe>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background: var(--email-paper, #ffffff);
    }

    .email-thumbnail__frame {
      position: absolute;
      inset-block-start: 0;
      inset-inline-start: 0;
      inline-size: 600px;
      border: 0;
      transform-origin: 0 0;
      pointer-events: none;
      background: var(--email-paper, #ffffff);
      opacity: 0;
      transition: opacity 200ms ease-out;
    }

    :host([data-loaded]) .email-thumbnail__frame {
      opacity: 1;
    }

    @media (prefers-reduced-motion: reduce) {
      .email-thumbnail__frame {
        transition: none;
      }
    }
  `,
  host: {
    // The paper it is drawn on, as an island's: `--email-paper` round it.
    '[attr.data-paper-scheme]': 'paper()',
    '[attr.data-loaded]': 'loaded() || null',
    '[style.aspect-ratio]': 'aspect()',
  },
})
export class EmailThumbnail {
  readonly #sanitizer = inject(DomSanitizer);
  readonly #editorPaper = inject(Paper).scheme;
  readonly #island = inject(GridIsland, { optional: true });

  /** The email: a fragment or a whole document. */
  readonly html = input.required<string>();

  /** Light or dark paper; the editor's own when not given. */
  readonly scheme = input<PaperScheme | null>(null);

  /** Width over height. */
  readonly aspect = input(4 / 3);

  /** The thumbnail's width, px: a grid column's; off a grid, half the
      email's. */
  readonly width = input<number | null>(null);

  protected readonly paper = computed(() => this.scheme() ?? this.#editorPaper());

  /** The width it is drawn at, px. */
  readonly #shown = computed(() => this.width() ?? this.#island?.columnWidth() ?? EMAIL_WIDTH / 2);

  /** Shrunk to fit, never grown: an email is not drawn past its 600px. */
  protected readonly scale = computed(() => Math.min(1, this.#shown() / EMAIL_WIDTH));

  /** As much of the email as the thumbnail shows, at its own width: the
      thumbnail's height, unscaled. */
  protected readonly frameHeight = computed(() =>
    Math.ceil(this.#shown() / this.aspect() / this.scale()),
  );

  /** Its 600px centred in a thumbnail wider than that; 0 otherwise. */
  protected readonly offset = computed(() => (this.#shown() - EMAIL_WIDTH * this.scale()) / 2);

  protected readonly loaded = signal(false);

  /** The drawing — a frame with no scripts and no origin of its own, so
      passing the sanitizer by is safe here, as the viewer's is. */
  protected readonly document = computed<SafeHtml>(() =>
    this.#sanitizer.bypassSecurityTrustHtml(
      dawnDocument(framePendingImages(this.html()), { scheme: this.paper(), inset: MARGIN }) +
        STILL +
        (hasDocumentEnvelope(this.html()) ? '' : LETTER),
    ),
  );
}
