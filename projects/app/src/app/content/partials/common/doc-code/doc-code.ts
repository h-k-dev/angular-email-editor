import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, inject, input, resource, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

import { CodeHighlighter, CodeLanguage } from '../../../../core/docs/code-highlighter';

/** What the bar calls each language. */
const LANGUAGE_NAMES: Record<CodeLanguage, string> = {
  ts: 'TypeScript',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  bash: 'Terminal',
};

/** How long "Copied" stays, ms. */
const COPIED_FOR = 1500;

/**
 * A block of code, GitHub's: a bar naming it (or its language) with a copy
 * button, then the code coloured by `CodeHighlighter` — plain text until
 * the colours arrive, the same text either way, so nothing moves.
 *
 *     <doc-code [code]="example" lang="ts" label="Example" />
 *
 * A single line is a pill, hairline's: no bar, the copy button at its end,
 * `prompt` (`$`) before a command. Long lines scroll sideways, as code
 * does; `wrap` wraps them instead (a signature, read rather than run).
 */
@Component({
  selector: 'doc-code',
  imports: [MatIcon, NgTemplateOutlet],
  templateUrl: './doc-code.html',
  styleUrl: './doc-code.scss',
  host: { '[attr.data-wrap]': 'wrap() || null' },
})
export class DocCode {
  readonly code = input.required<string>();
  readonly lang = input<CodeLanguage>('ts');
  /** What the bar says — the language's name when unset; `''` for no bar,
      the copy button in the block's corner. */
  readonly label = input<string | null>(null);
  readonly wrap = input(false);
  /** Shown before the code, never copied: `$` before a command. */
  readonly prompt = input<string | null>(null);

  protected readonly pill = computed(() => !this.code().includes('\n'));
  protected readonly bar = computed(() => !this.pill() && this.label() !== '');

  protected readonly heading = computed(() => this.label() ?? LANGUAGE_NAMES[this.lang()]);

  readonly #highlighter = inject(CodeHighlighter);
  protected readonly lines = resource({
    params: () => ({ code: this.code(), lang: this.lang() }),
    loader: ({ params }) => this.#highlighter.tokens(params.code, params.lang),
  });

  /** The copy button says "Copied" for a moment after a copy. */
  protected readonly copied = signal(false);
  #copiedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.#copiedTimer));
  }

  protected async copy(): Promise<void> {
    await navigator.clipboard?.writeText(this.code());
    this.copied.set(true);
    clearTimeout(this.#copiedTimer);
    this.#copiedTimer = setTimeout(() => this.copied.set(false), COPIED_FOR);
  }
}
