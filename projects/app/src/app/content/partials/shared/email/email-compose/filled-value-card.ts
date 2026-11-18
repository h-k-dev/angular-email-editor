import {
  ApplicationRef,
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

/** How long the page must stay still before a card opens on what was just
    scrolled to, ms — a scroll's events come a frame late, smooth ones for
    a while. */
const STILL = 60;

/** Runs `then` once no scroll — of the page or of any scroller in it — has
    happened for {@link STILL} ms; returns what cancels it. */
function whenStill(then: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    clearTimeout(timer);
    document.removeEventListener('scroll', wait, true);
  };
  const wait = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stop();
      then();
    }, STILL);
  };
  document.addEventListener('scroll', wait, true);
  wait();
  return stop;
}

/** The card's rows, as its menu names them (`ngMenuItem` values). */
export type FilledCardAction = 'edit' | 'remove' | 'reset' | 'restore';

/** How long the card stays once focus has left it for somewhere else —
    time for focus to come back (it crosses the text on its way from a row
    to the field). */
const FOCUS_GRACE = 300;

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
 * Comes at once and stays, as a menu does: the pointer leaving the value or
 * the card never takes it. A pick closes it, and so do Escape (the caret
 * back in the text), a press anywhere outside — on its own value too —
 * focus leaving it, and a scroll.
 *
 * Fed by `createMergeTagResolution({ onFilledHover })` and the pane's
 * {@link showUnfilled}; drawn by the HoverCards service, one card app-wide.
 * Made in an injection context.
 */
export class FilledValueCard {
  readonly #cards = inject(HoverCards);
  readonly #view = inject(ViewContainerRef);
  readonly #injector = inject(Injector);
  readonly #appRef = inject(ApplicationRef);
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
    // Off the value: the card is a menu by now, and stays — the pointer
    // does not close it.
    if (!hover) return;
    this.#clearTimer();
    const same = this.#card && hover.element === this.hover()?.element;
    // The same value again: it changed under the card — read it anew.
    this.hover.set(hover);
    if (same) return;
    this.unfilled.set(null);
    this.#open(hover.element);
  };

  /** Opens the card on a token with no value, focus on its first row —
      Send put the caret there, the keyboard carries on (the arrows walk
      the rows, Enter picks). */
  showUnfilled(token: UnfilledPlaceholder): void {
    this.#clearTimer();
    this.#stopWaiting();
    this.hover.set(null);
    this.unfilled.set(token);
    // Revealing the token scrolled to it — and a scroll's events come a
    // frame late, so a card opened now would be taken by the first of them
    // (cards go on scroll). It opens once the page has stopped moving.
    this.#stopWaiting = whenStill(() => {
      if (this.unfilled() !== token || !token.element.isConnected) return;
      this.#open(token.element);
      // Opened from a timer, no render is coming: one now, so the menu
      // knows its rows before the first takes focus (else the first arrow
      // only finds where it stands).
      this.#appRef.tick();
      this.#focusIn('[ngMenuItem][tabindex="0"], [ngMenuItem]');
    });
  }

  /** Cancels a card still waiting for the page to stop scrolling. */
  #stopWaiting: () => void = () => {};

  /** A row of the card's menu, picked — by the pointer, or Enter / Space
      on the row the arrows reached. */
  choose(action: FilledCardAction): void {
    switch (action) {
      case 'edit':
        return this.edit();
      case 'remove':
        return this.remove();
      case 'reset':
        return this.reset();
      case 'restore':
        return this.restore();
    }
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
    this.editing.set(false);
    // A press anywhere but in the card takes it, as for any menu — on the
    // value it stands on too. Heard on the way down, before anything stops it.
    const onPress = (event: PointerEvent) => {
      if (!card.pane.contains(event.target as Node | null)) this.#close();
    };
    document.addEventListener('pointerdown', onPress, true);
    const card = this.#cards.open(
      this,
      anchor,
      new TemplatePortal(this.#template(), this.#view, { $implicit: this }),
      {
        position: 'below',
        closed: () => {
          document.removeEventListener('pointerdown', onPress, true);
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
    // Focus leaving the card for somewhere else (Tab) lets it go, as a menu
    // goes. Focus going nowhere does not: the row that had it was taken
    // away — Edit swaps the rows for the field, which takes focus a render
    // later.
    pane.addEventListener('focusout', (event) => {
      const to = event.relatedTarget as Node | null;
      if (to && !pane.contains(to)) this.#closeLater();
    });
    // …and focus coming back holds it again.
    pane.addEventListener('focusin', () => this.#clearTimer());
    // Escape takes the card away, from anywhere in it, the caret back in
    // the text. Caught on the way down: the menu's rows answer Escape
    // themselves (a menu closing its submenus) and stop it there, before
    // the overlay's own Escape would hear it.
    pane.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        this.#close();
        this.#focusText();
      },
      true,
    );
    this.#card = card;
  }

  /** Focuses the card's first `selector` — at once when it is there (the
      card's rows are drawn as it opens, and it may open from a timer, with
      no render to come), else once it is drawn (the field Edit asks for). */
  #focusIn(selector: string, select = false): void {
    const focus = () => {
      const element = this.#card?.pane.querySelector<HTMLElement>(selector);
      element?.focus();
      if (select && element instanceof HTMLTextAreaElement) element.select();
      return !!element;
    };
    if (!focus()) afterNextRender(focus, { injector: this.#injector });
  }

  #closeLater(): void {
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      // Read, not tracked: where focus is when the wait is over.
      if (!this.#card?.pane.contains(document.activeElement)) this.#close();
    }, FOCUS_GRACE);
  }

  #close(): void {
    this.#clearTimer();
    this.#stopWaiting();
    this.#card = null;
    // `hover` stays as it was while the card leaves (`closed` clears it).
    this.#cards.close(this);
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}
