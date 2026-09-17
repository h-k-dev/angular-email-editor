import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Library
import { InlineImages, emailPlainText } from 'angular-email-editor';

/** Approximates a mail client's rendering surface: default typography on
    white — the email itself carries no such defaults, the client does. */
const CLIENT_SURFACE = `
  body { margin: 16px; background: #ffffff; color: #202124;
         font-family: Arial, Helvetica, sans-serif; font-size: 14px;
         line-height: 20px; word-wrap: break-word; }
`;

/** Simulated Gmail-style forced inversion: invert + hue-rotate keeps
    mid-tones roughly themselves (the dual-contrast band), flips the
    extremes — a simulation, not a screenshot, and labeled as such. */
const FORCED_INVERSION = `
  html { filter: invert(1) hue-rotate(180deg); background: #ffffff; }
  img { filter: invert(1) hue-rotate(180deg); }
`;

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

  /** Whether the preview is on screen. While it is not, it holds still: a
      hidden frame's `srcdoc` would still be parsed and laid out on every
      keystroke, for nobody. */
  active = input(true);

  /** The html the preview shows: `html` while active, and the last one it
      showed while hidden — the source reads `html` only when active, so a
      hidden preview does not even depend on it. Catches up when shown. */
  readonly #shown = linkedSignal<string | null, string>({
    source: () => (this.active() ? this.html() : null),
    computation: (html, previous) => html ?? previous?.value ?? '',
  });

  view = signal<'html' | 'text'>('html');
  mode = signal<'light' | 'dark'>('light');
  protected readonly PHONE_WIDTH = PHONE_WIDTH;

  /** The composer's registry: `cid:` sources become data URLs for the frame
      (an opaque-origin sandbox cannot load the editor's blob URLs). */
  readonly #images = inject(InlineImages);

  /** Our own canonical HTML inside a fully sandboxed frame (no scripts, no
      same-origin), so bypassing the sanitizer is safe here. */
  document = computed<SafeHtml>(() =>
    this.#sanitizer.bypassSecurityTrustHtml(
      `<!doctype html><html><head><meta charset="utf-8"><style>${CLIENT_SURFACE}${
        this.mode() === 'dark' ? FORCED_INVERSION : ''
      }</style></head><body>${this.#images.previewHtml(this.#shown())}</body></html>`,
    ),
  );

  /** The text/plain alternative of the same signal. */
  text = computed(() => emailPlainText(this.#shown()));
}
