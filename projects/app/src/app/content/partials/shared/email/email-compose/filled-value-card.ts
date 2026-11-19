import {
  ApplicationRef,
  DestroyRef,
  Injector,
  TemplateRef,
  ViewContainerRef,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { TemplatePortal } from '@angular/cdk/portal';
import type { MergeTagHover } from '@h-k-dev/angular-email-editor';
import { HoverCardOpen, HoverCards } from '../../../common/hover-card/hover-card';

/** What the card's template is handed: the card itself. */
export interface FilledValueContext {
  $implicit: FilledValueCard;
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

/** How long the card stays once focus has left it for somewhere else —
    time for focus to come back (it crosses the text on its way from a row
    to the field). */
const FOCUS_GRACE = 300;

/**
 * The card beside a placeholder — the library's (`email-merge-tag-card`),
 * held up here. Two ways in:
 *
 * - **⌘ (Ctrl off a Mac) held over a placeholder** — the layout guides'
 *   peek: a token before a parse (**Parse** this one alone, **Write a
 *   value** in a message, **Remove placeholder**), a filled-in value after
 *   one (**Edit value**, **Reset** on a value written over, **Restore
 *   placeholder**), a template's previewed value (**Show placeholder**,
 *   **Remove placeholder**). The same card in a message and on a design
 *   desk: its rows are the ways the editor reports (`MergeTagHover`).
 * - **A token with no value, where Send put the caret** (the body's
 *   `placeholder.unfilled` error, through `focusBoundControl`): **Write a
 *   value**, or **Remove placeholder** — an empty value is only ever the
 *   writer's explicit say.
 *
 * Comes at once and stays, as a menu does: the pointer leaving the
 * placeholder or the card never takes it. A pick closes it, and so do
 * Escape (the caret back in the text), a press anywhere outside — on its
 * own placeholder too — focus leaving it, and a scroll.
 *
 * Fed by `createMergeTagHover({ onHover })` and the pane's
 * {@link showUnfilled}; drawn by the HoverCards service, one card app-wide.
 * This holds only where the card floats and when it goes: what it says and
 * does is the library's. Made in an injection context.
 */
export class FilledValueCard {
  readonly #cards = inject(HoverCards);
  readonly #view = inject(ViewContainerRef);
  readonly #injector = inject(Injector);
  readonly #appRef = inject(ApplicationRef);
  readonly #template: () => TemplateRef<FilledValueContext>;
  readonly #focusText: () => void;

  /** The placeholder the card is up for, as last reported. */
  readonly hover = signal<MergeTagHover | null>(null);
  /** It is up for a token with no value, where Send put the caret — the
      card says so. */
  readonly unfilled = signal(false);

  #card: HoverCardOpen | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;

  /** `focusText` puts the caret back in the text when the card goes with
      focus in it. */
  constructor(template: () => TemplateRef<FilledValueContext>, focusText: () => void) {
    this.#template = template;
    this.#focusText = focusText;
    inject(DestroyRef).onDestroy(() => this.#close());
  }

  /** The extension's `onHover`. */
  readonly onHover = (hover: MergeTagHover | null): void => {
    // Off the value: the card is a menu by now, and stays — the pointer
    // does not close it.
    if (!hover) return;
    this.#clearTimer();
    const same = this.#card && hover.element === this.hover()?.element;
    // The same value again: it changed under the card — read it anew.
    this.hover.set(hover);
    if (same) return;
    this.unfilled.set(false);
    this.#open(hover.element);
  };

  /** Opens the card on a token with no value, focus on its first row —
      Send put the caret there, the keyboard carries on (the arrows walk
      the rows, Enter picks). */
  showUnfilled(token: MergeTagHover): void {
    this.#clearTimer();
    this.#stopWaiting();
    this.hover.set(token);
    this.unfilled.set(true);
    // Revealing the token scrolled to it — and a scroll's events come a
    // frame late, so a card opened now would be taken by the first of them
    // (cards go on scroll). It opens once the page has stopped moving.
    this.#stopWaiting = whenStill(() => {
      if (this.hover() !== token || !token.element.isConnected) return;
      this.#open(token.element);
      // Opened from a timer, no render is coming: one now, so the rows are
      // there before the first takes focus.
      this.#appRef.tick();
      this.#focusIn('[role="menuitem"]');
    });
  }

  /** Cancels a card still waiting for the page to stop scrolling. */
  #stopWaiting: () => void = () => {};

  /** A way of the card ran (`email-merge-tag-card`'s `done`): it goes. */
  done(): void {
    this.#close();
  }

  #open(anchor: HTMLElement): void {
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
          this.unfilled.set(false);
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
      no render to come), else once it is drawn. */
  #focusIn(selector: string): void {
    const focus = () => {
      const element = this.#card?.pane.querySelector<HTMLElement>(selector);
      element?.focus();
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
