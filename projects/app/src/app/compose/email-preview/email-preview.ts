import { Component, computed, inject, input, linkedSignal, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Library
import {
  CLIENT_LABELS,
  InlineImages,
  RENDERING_CLIENTS,
  RenderingClient,
  emailPlainText,
  renderForClient,
} from 'angular-email-editor';

import { atRest } from '../at-rest';

/** Approximates a mail client's rendering surface: default typography on
    white — the email itself carries no such defaults, the client does. */
/** The preview is phone-width, full stop: per the responsiveness ledger, an
    email that reads at 320px is free at any desktop width — so a wider
    preview never shows anything a narrower one did not already prove. */
const PHONE_WIDTH = 320;
/**
 * The third projection of the canonical `html` signal: a strictly read-only,
 * sandboxed rendering of what the recipient sees, at phone width.
 */
@Component({
  selector: 'section[email-preview]',
  templateUrl: './email-preview.html',
  styleUrl: './email-preview.scss',
})
export class EmailPreview {
  #sanitizer = inject(DomSanitizer);

  /** Canonical email HTML — input only; a preview never talks back. */
  html = input('');

  /** The HTML as it came in — pasted into the source pane, or an example
      loaded whole — before the editor read it, where there is one. The
      preview can show it beside the editor's reading, for each client. */
  original = input<string | null>(null);

  /** Whether the preview is on screen. While it is not, it holds still: a
      hidden frame's `srcdoc` would still be parsed and laid out on every
      keystroke, for nobody. */
  active = input(true);

  /** `html` once typing rests: each new email re-parses and re-lays-out the
      whole frame — longer, on a large email, than a fast typist's gap
      between two keys. A single write (an example, an import) lands at
      once; a burst of typing, when it stops (`atRest`). */
  readonly #paced = atRest(this.html);

  /** The html the preview shows: `html` while active (at rest), and the
      last one it showed while hidden — the source reads it only when
      active, so a hidden preview does not even depend on it. Shown again it
      catches up *exactly*: the moment it opens takes `html` itself, not a
      settled value that may still be waiting for a rest. */
  readonly #shown = linkedSignal<string | null, string>({
    source: () => (this.active() ? (this.#paced.value() ?? '') : null),
    computation: (html, previous) => {
      if (html === null) return previous?.value ?? '';
      return previous && previous.source === null ? untracked(this.html) : html;
    },
  });

  view = signal<'html' | 'text'>('html');
  mode = signal<'light' | 'dark'>('light');

  /** The client the frame draws for — Apple Mail reads it all, Gmail and
      Outlook each in their way (`renderForClient`). */
  client = signal<RenderingClient>('apple-mail');
  protected readonly clients = RENDERING_CLIENTS;
  protected readonly clientLabels = CLIENT_LABELS;

  /** Whose HTML the frame draws: the editor's canonical form, or the
      original as it came in. Back to the editor's when no original is. */
  source = linkedSignal<string | null, 'editor' | 'original'>({
    source: this.original,
    computation: (original, previous) =>
      original && previous?.value === 'original' ? 'original' : 'editor',
  });
  protected readonly PHONE_WIDTH = PHONE_WIDTH;

  /** The composer's registry: `cid:` sources become data URLs for the frame
      (an opaque-origin sandbox cannot load the editor's blob URLs). */
  readonly #images = inject(InlineImages);

  /** The HTML the frame draws for its client — the editor's, or the
      original — inside a fully sandboxed frame (no scripts, no
      same-origin), so bypassing the sanitizer is safe here. */
  document = computed<SafeHtml>(() => {
    const original = this.original();
    const html =
      this.source() === 'original' && original ? original : this.#images.previewHtml(this.#shown());
    return this.#sanitizer.bypassSecurityTrustHtml(
      renderForClient(html, this.client(), { dark: this.mode() === 'dark' }),
    );
  });

  /** The text/plain alternative of the same signal. */
  text = computed(() => emailPlainText(this.#shown()));
}
