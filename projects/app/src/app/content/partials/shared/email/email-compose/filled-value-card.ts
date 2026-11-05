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

/** A token with no value for the contact, where a send put the caret —
    its pill, its expression, and what can be done about it. */
export interface UnfilledPlaceholder {
  /** The pill (or the node, the link) — the card's anchor. */
  readonly element: HTMLElement;
  /** The expression, trimmed. */
  readonly expr: string;
  /** Writes `text` by hand in place of every token holding `expr`. */
  write(text: string): boolean;
  /** Removes every token holding `expr` — the explicit empty value. */
  remove(): boolean;
}

/** How long the card stays after the pointer has left the value and the
    card — time to cross into it (a hover card's own hide delay). */
const HIDE_DELAY = 300;

/**
 * The card beside a placeholder, two ways in:
 *
 * - **A filled-in value, Ctrl held over it** — the layout guides' peek,
 *   which paints every value the pill's colour: the token it was, then
 *   **Edit value** (a field over the value as it reads; Enter writes it in
 *   by hand, Shift-Enter a line break — still the token's), **Reset** on a
 *   value written over, **Restore placeholder** (the token again).
 * - **A token with no value, where Send put the caret** (the body's
 *   `placeholder.unfilled` error, through `focusBoundControl`): **Write a
 *   value**, or **Remove placeholder** — an empty value is only ever the
 *   writer's explicit say.
 *
 * Comes at once, stays while the pointer is on the value or in the card and
 * while focus is in it (read when it would go, not tracked). Escape takes it
 * away, the caret back in the text.
 *
 * Fed by `createMergeTagResolution({ onFilledHover })` and the pane's
 * {@link showUnfilled}; drawn by the HoverCards service, one card app-wide.
 * Made in an injection context.
 */
export class FilledValueCard {
  readonly #cards = inject(HoverCards);
  readonly #view = inject(ViewContainerRef);
  readonly #injector = inject(Injector);
  readonly #template: () => TemplateRef<FilledValueContext>;
  readonly #focusText: () => void;

  /** The filled value the card is up for, as last reported. */
  readonly hover = signal<FilledMergeTagHover | null>(null);
  /** …or the token with no value it is up for. */
  readonly unfilled = signal<UnfilledPlaceholder | null>(null);
  /** The edit field is open. */
  readonly editing = signal(false);
  /** What the edit field holds. */
  readonly draft = signal('');
  /** The token the card is about — `{{ customer_lastName }}`. */
  readonly token = computed(() => {
    const expr = this.unfilled()?.expr ?? this.hover()?.expr;
    return expr ? `{{ ${expr} }}` : '';
  });

  #card: HoverCardOpen | null = null;
  #onCard = false;
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** `focusText` puts the caret back in the text when the card goes with
      focus in it. */
  constructor(template: () => TemplateRef<FilledValueContext>, focusText: () => void) {
    this.#template = template;
    this.#focusText = focusText;
    inject(DestroyRef).onDestroy(() => this.#close());
  }

  /** The extension's `onFilledHover`. */
  readonly onHover = (hover: FilledMergeTagHover | null): void => {
    if (!hover) return this.#closeLater();
    this.#clearTimer();
    const same = this.#card && hover.element === this.hover()?.element;
    // The same value again: it changed under the card — read it anew.
    this.hover.set(hover);
    if (same) return;
    this.unfilled.set(null);
    this.#open(hover.element);
  };

  /** Opens the card on a token with no value, focus on its first button —
      Send put the caret there, the keyboard carries on. */
  showUnfilled(token: UnfilledPlaceholder): void {
    this.#clearTimer();
    this.hover.set(null);
    this.unfilled.set(token);
    this.#open(token.element);
    this.#focusIn('button');
  }

  /** Opens the field: over the value as it reads, or empty for a token
      with no value. */
  edit(): void {
    this.draft.set(this.hover()?.text ?? '');
    this.editing.set(true);
    this.#focusIn('textarea', true);
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

  /** Writes the draft in, still the token's. */
  apply(): void {
    const draft = this.draft();
    if (!draft) return;
    const unfilled = this.unfilled();
    if (unfilled ? unfilled.write(draft) : this.hover()?.edit(draft)) this.#close();
  }

  /** The token with no value goes — the explicit empty value. */
  remove(): void {
    this.unfilled()?.remove();
    this.#close();
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

  #open(anchor: HTMLElement): void {
    this.#onCard = false;
    this.editing.set(false);
    const card = this.#cards.open(
      this,
      anchor,
      new TemplatePortal(this.#template(), this.#view, { $implicit: this }),
      {
        position: 'below',
        closed: () => {
          // Taken away with focus in it (Escape): the caret back in the text.
          const active = document.activeElement;
          if (!active || active === document.body || card.pane.contains(active)) this.#focusText();
          if (this.#card !== card) return;
          this.#card = null;
          this.hover.set(null);
          this.unfilled.set(null);
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

  /** Focuses the card's first `selector` once it is drawn. */
  #focusIn(selector: string, select = false): void {
    afterNextRender(
      () => {
        const element = this.#card?.pane.querySelector<HTMLElement>(selector);
        element?.focus();
        if (select && element instanceof HTMLTextAreaElement) element.select();
      },
      { injector: this.#injector },
    );
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
