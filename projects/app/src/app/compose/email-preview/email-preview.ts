import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

// Library
import { emailPlainText } from 'angular-email-editor';

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

/**
 * The third projection of the canonical `html` signal: a strictly read-only,
 * sandboxed rendering of what the recipient sees. Phone-width (320px) first,
 * per the responsiveness ledger — if it reads narrow, desktop is free.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'section[email-preview]',
  templateUrl: './email-preview.html',
  styleUrl: './email-preview.scss',
})
export class EmailPreview {
  #sanitizer = inject(DomSanitizer);

  /** Canonical email HTML — input only; a preview never talks back. */
  html = input('');

  view = signal<'html' | 'text'>('html');
  mode = signal<'light' | 'dark'>('light');
  width = signal<320 | 600>(320);

  /** Our own canonical HTML inside a fully sandboxed frame (no scripts, no
      same-origin), so bypassing the sanitizer is safe here. */
  document = computed<SafeHtml>(() =>
    this.#sanitizer.bypassSecurityTrustHtml(
      `<!doctype html><html><head><meta charset="utf-8"><style>${CLIENT_SURFACE}${
        this.mode() === 'dark' ? FORCED_INVERSION : ''
      }</style></head><body>${this.html()}</body></html>`,
    ),
  );

  /** The text/plain alternative of the same signal. */
  text = computed(() => emailPlainText(this.html()));
}
