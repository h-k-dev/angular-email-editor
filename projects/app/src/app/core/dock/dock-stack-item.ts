import {
  Directive,

  // Signals
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';

import { DockStack, STACK_COUNTER_GAP, STACK_COUNTER_WIDTH } from './dock-stack';

/**
 * An element whose thing can minimize onto the dock's stack (`DockStack`)
 * — a compose window, a note. A host directive: the component says which
 * entry is its own and what it is called ({@link bind}), and this carries
 * the stack's state onto the element for the stylesheet
 * (`styles/_dock-stack`, `dock-stack.item`):
 *
 * - `data-stacked` — its number on the stack, 0 the top — while it is on
 *   it. On the stack it is out of sight and `inert`: the stack's menu
 *   lists it, by the name given here, and brings it back.
 * - `data-stack-top` while it is the bar the folded stack leaves on the
 *   edge — the last thing minimized, with nothing open there: that bar is
 *   this element itself.
 * - `--dock-stack-x`, the stack's place (px from the right side of the
 *   screen), and `--dock-stack-counter`, the room the counter takes beside
 *   the bar on the edge.
 * - A pointer over the bar on the edge, or the focus in it, opens the
 *   stack's menu as the counter does; Escape closes it.
 *
 * The element stays where it is in the page whatever the stack does: only
 * its style changes, so what it holds — an editor — is never re-created.
 */
@Directive({
  selector: '[dockStackItem]',
  host: {
    '[attr.data-stacked]': 'stacked() ? index() : null',
    '[attr.data-stack-top]': 'shown() || null',
    '[attr.inert]': 'buried() || null',
    '[style.--dock-stack-x.px]': 'stacked() ? stack.place() : null',
    '[style.--dock-stack-counter.px]': 'counterRoom()',
    '(focusin)': 'hover(true)',
    '(focusout)': 'hover(false)',
    '(pointerenter)': 'hover(true)',
    '(pointerleave)': 'hover(false)',
    '(keydown.escape)': 'escape($event)',
  },
})
export class DockStackItem {
  protected readonly stack = inject(DockStack);

  readonly #bound = signal<{ key: () => string; label: () => string } | null>(null);

  constructor() {
    // The entry's name in the stack's menu, for as long as this element
    // says it is that entry.
    effect((onCleanup) => {
      const bound = this.#bound();
      if (bound) onCleanup(this.stack.describe(bound.key(), bound.label));
    });
  }

  /** Says which of the stack's entries this element is — its key — and
      what it is called, each read as a signal is: the component's own
      state says both. */
  bind(key: () => string, label: () => string): void {
    this.#bound.set({ key, label });
  }

  /** Where it is on the stack — 0 its top — or -1 off it. */
  readonly index = computed(() => {
    const bound = this.#bound();
    return bound ? this.stack.indexOf(bound.key()) : -1;
  });
  /** Whether its thing is minimized onto the stack. */
  readonly stacked = computed(() => this.index() >= 0);
  /** The stack's bar on the edge while it is folded. */
  readonly shown = computed(() => this.stacked() && this.index() < this.stack.shown());
  /** On the stack and not its bar on the edge: out of sight and out of
      reach — the menu's to bring back. */
  readonly buried = computed(() => this.stacked() && !this.shown());

  /** The room the stack's counter takes left of this bar, px — the bar on
      the edge, where there are more under it: the bar gives it up where
      the screen is short of room for both. */
  protected readonly counterRoom = computed(() =>
    this.shown() && this.stack.hidden() > 0 ? STACK_COUNTER_WIDTH + STACK_COUNTER_GAP : null,
  );

  /** A pointer or the focus came onto the bar on the edge, or left it: the
      stack's menu opens, or closes a moment later. */
  protected hover(over: boolean): void {
    if (!this.shown()) return;
    if (over) this.stack.fan();
    else this.stack.fold();
  }

  /** Escape on the bar on the edge closes the stack's menu — unless
      something inside took the key first. */
  protected escape(event: Event): void {
    if (event.defaultPrevented || !this.shown() || !this.stack.open()) return;
    event.preventDefault();
    this.stack.fold(true);
  }
}
