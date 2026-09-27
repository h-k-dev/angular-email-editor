import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
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

/** The desktop reading pane: wider than the email's own 600px container,
    the way a client's pane is — the page shows round the card, and the
    card's columns get their 600px. At exactly 600px the client's margins
    would leave the card 568px, and two 280px columns wrap. */
const DESKTOP_WIDTH = 680;

/** The stage's inset round the frame, each side (the stylesheet's). */
const STAGE_INSET = 16;
/**
 * The third projection of the canonical `html` signal: a strictly read-only,
 * sandboxed rendering of what the recipient sees, at phone width.
 */
@Component({
  selector: 'section[email-preview]',
  templateUrl: './email-preview.html',
  styleUrl: './email-preview.scss',
  // The pane is as wide as its frame and no wider — the controls wrap
  // inside that, so a longer row of buttons never widens the pane — and
  // never wider than its flank: past that the frame scales down to fit.
  host: { '[style.inline-size]': 'hostWidth()' },
})
export class EmailPreview {
  #sanitizer = inject(DomSanitizer);

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

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
  /** The reading pane the frame stands for: a phone (320px, the ledger's
      first width) or a desktop client's 600px. */
  device = signal<'phone' | 'desktop'>('phone');

  /** The frame's own width — the device's, before any scaling. */
  protected readonly deviceWidth = computed(() =>
    this.device() === 'phone' ? PHONE_WIDTH : DESKTOP_WIDTH,
  );

  /** What the host asks of its flank: the frame plus the stage's inset, or
      the flank's whole width where that is less. */
  protected readonly hostWidth = computed(
    () => `min(${this.deviceWidth() + 2 * STAGE_INSET}px, 100%)`,
  );

  /** The host's width as laid out — the flank may give less than asked. */
  readonly #laidOut = signal<{ width: number; height: number } | null>(null);

  /** How far the frame is scaled to fit: 1 while the stage is wide enough
      for the device, less where it is not (a 600px desktop in a narrow
      flank) — the frame keeps the device's width and shrinks as a whole,
      so the layout inside is the device's, not a narrower one's. */
  protected readonly scale = computed(() => {
    const laidOut = this.#laidOut();
    if (!laidOut) return 1;
    const room = laidOut.width - 2 * STAGE_INSET;
    return room > 0 ? Math.min(1, room / this.deviceWidth()) : 1;
  });

  /** The stage's height, for the frame to fill once scaled. */
  protected readonly stageHeight = computed(() => this.#laidOut()?.height ?? null);

  /** The composer's registry: `cid:` sources become data URLs for the frame
      (an opaque-origin sandbox cannot load the editor's blob URLs). */
  readonly #images = inject(InlineImages);

  /** The stage, measured: its width sets the scale, its height the frame. */
  protected readonly stage = signal<HTMLElement | null>(null);

  constructor() {
    afterNextRender({
      write: () => {
        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const target = entry.target as HTMLElement;
            const rect = target.getBoundingClientRect();
            this.#laidOut.set({ width: rect.width, height: rect.height });
          }
        });
        // The stage is in the DOM whenever the host is: observe it once; a
        // view toggle keeps the stage and swaps what stands in it.
        const stage = this.#host.nativeElement.querySelector<HTMLElement>('.stage');
        if (stage) observer.observe(stage);
        this.#destroy.onDestroy(() => observer.disconnect());
      },
    });
  }

  readonly #destroy = inject(DestroyRef);

  /** The HTML the frame draws for its client — the editor's, or the
      original — inside a fully sandboxed frame (no scripts, no
      same-origin), so bypassing the sanitizer is safe here. */
  document = computed<SafeHtml>(() => {
    const original = this.original();
    const html =
      this.source() === 'original' && original ? original : this.#images.previewHtml(this.#shown());
    return this.#sanitizer.bypassSecurityTrustHtml(
      renderForClient(html, this.client(), { dark: this.mode() === 'dark', pane: this.device() }),
    );
  });

  /** The text/plain alternative of the same signal. */
  text = computed(() => emailPlainText(this.#shown()));
}
