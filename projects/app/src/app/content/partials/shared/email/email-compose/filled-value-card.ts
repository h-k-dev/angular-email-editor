import {
  DestroyRef,
  Injector,
  TemplateRef,
  ViewContainerRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { TemplatePortal } from '@angular/cdk/portal';
import type { FilledMergeTagHover } from '@h-k-dev/angular-email-editor';
import { HoverCardOpen, HoverCards } from '../../../common/hover-card/hover-card';

/** What the card's template is handed: the card itself. */
export interface FilledValueContext {
  $implicit: FilledValueCard;
}

/** How long the card stays after the pointer has left the value and the
    card — time to cross into it (a hover card's own hide delay). */
const HIDE_DELAY = 300;

/**
 * The card a filled-in placeholder's value shows while Ctrl is held — the
 * layout guides' peek, which paints every value the pill's colour: the
 * token it was, and what can be done with the value —
 *
 * - **Edit value**: a field over the value as it reads; Enter writes it in
 *   by hand (Shift-Enter a line break), and it is still the token's;
 * - **Reset**, on a value written over: the value as filled in, again;
 * - **Restore placeholder**: the token, a pill again.
 *
 * Comes at once (Ctrl held is the deliberate gesture, no show delay), stays
 * while the pointer is on the value or in the card — Ctrl released or not —
 * and while its field has focus. Escape takes it away.
 *
 * Fed by `createMergeTagResolution({ onFilledHover })`; drawn by the
 * HoverCards service, one card app-wide. Made in an injection context.
 */
export class FilledValueCard {
  readonly #cards = inject(HoverCards);
  readonly #view = inject(ViewContainerRef);
  readonly #injector = inject(Injector);
  readonly #template: () => TemplateRef<FilledValueContext>;

  /** The value the card is up for, as last reported. */
  readonly hover = signal<FilledMergeTagHover | null>(null);
  /** The edit field is open. */
  readonly editing = signal(false);
  /** What the edit field holds. */
  readonly draft = signal('');
  /** The token the value took the place of — `{{ customer_lastName }}`. */
  readonly token = computed(() => {
    const expr = this.hover()?.expr;
    return expr ? `{{ ${expr} }}` : '';
  });

  #card: HoverCardOpen | null = null;
  #onCard = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(template: () => TemplateRef<FilledValueContext>) {
    this.#template = template;
    inject(DestroyRef).onDestroy(() => this.#close());
  }

  /** The extension's `onFilledHover`. */
  readonly onHover = (hover: FilledMergeTagHover | null): void => {
    if (!hover) return this.#closeLater();
    this.#clearTimer();
    const same = this.#card && hover.element === this.hover()?.element;
    // The same value again: it changed under the card — read it anew.
    this.hover.set(hover);
    if (!same) this.#open(hover);
  };

  /** Opens the field over the value as it reads. */
  edit(): void {
    this.draft.set(this.hover()?.text ?? '');
    this.editing.set(true);
    afterNextRender(
      () => {
        const field = this.#card?.pane.querySelector('textarea');
        field?.focus();
        field?.select();
      },
      { injector: this.#injector },
    );
  }

  /** The field, typed in. */
  input(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  /** The field's keys: Enter writes the value in, Shift-Enter is a line
      break. */
  keydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.apply();
  }

  /** Writes the draft over the value, still the token's. */
  apply(): void {
    if (this.hover()?.edit(this.draft())) this.#close();
  }

  /** The value as filled in, again. */
  reset(): void {
    this.hover()?.reset();
    this.#close();
  }

  /** The token, a pill again. */
  restore(): void {
    this.hover()?.restore();
    this.#close();
  }

  #open(hover: FilledMergeTagHover): void {
    this.#onCard = false;
    this.editing.set(false);
    const card = this.#cards.open(
      this,
      hover.element,
      new TemplatePortal(this.#template(), this.#view, { $implicit: this }),
      {
        position: 'below',
        closed: () => {
          if (this.#card !== card) return;
          this.#card = null;
          this.hover.set(null);
          this.editing.set(false);
        },
      },
    );
    const pane = card.pane;
    pane.addEventListener('pointerenter', () => {
      this.#onCard = true;
      this.#clearTimer();
    });
    pane.addEventListener('pointerleave', () => {
      this.#onCard = false;
      this.#closeLater();
    });
    // Focus leaving the card (a click back in the text) lets it go.
    pane.addEventListener('focusout', (event) => {
      if (!pane.contains(event.relatedTarget as Node | null)) this.#closeLater();
    });
    this.#card = card;
  }

  #closeLater(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      // Read, not tracked: where focus is when the wait is over.
      const focused = !!this.#card?.pane.contains(document.activeElement);
      if (!this.#onCard && !focused) this.#close();
    }, HIDE_DELAY);
  }

  #close(): void {
    this.#clearTimer();
    this.#card = null;
    this.#onCard = false;
    // `hover` stays as it was while the card leaves (`closed` clears it).
    this.#cards.close(this);
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
