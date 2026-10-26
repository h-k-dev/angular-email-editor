import {
  Directive,
  ElementRef,
  Signal,
  booleanAttribute,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

import { FloatingScrollbar } from '../../../content/partials/common/floating-scrollbar/floating-scrollbar';

/**
 * The one element that scrolls a view, told to everything inside it: the
 * owner of the scroll. A part that would scroll itself (the writer's body,
 * the editor's text) asks for an owner through DI and, finding one, hands
 * its scrolling up — it grows with what it holds instead, and its sticky
 * parts stick to the owner. So one view scrolls once: a composer that
 * scrolled itself inside a scrolling sheet would scroll twice.
 *
 *     <main scrollOwner>…<section email-compose></section></main>
 *     <form email-writer [scrollOwner]="layout() === 'document'">…</form>
 *
 * The owner scrolls on its block axis, with a floating bar
 * (`FloatingScrollbar`), and keeps clear at its foot what is stuck there —
 * the editor's floating foot (`stickFoot`), as its end scroll padding: a
 * focused row scrolls clear of it, and so does the bar's rail. Off
 * (`[scrollOwner]="false"`), it is no owner: the parts scroll themselves
 * as they would without it.
 */
@Directive({
  selector: '[scrollOwner]',
  hostDirectives: [FloatingScrollbar],
  host: {
    '[attr.data-scroll-owner]': 'active() || null',
    '[style.overflow-y]': "active() ? 'auto' : null",
    '[style.overscroll-behavior-y]': "active() ? 'contain' : null",
    '[style.scroll-padding-block-end.px]': 'active() ? footRoom() : null',
  },
})
export class ScrollOwner {
  /** Whether this element owns the scroll. */
  readonly active = input(true, { alias: 'scrollOwner', transform: booleanAttribute });

  /** The element that scrolls. */
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** What is stuck to the owner's foot, each as the room it covers, px. */
  readonly #feet = signal<readonly Signal<number>[]>([]);

  /** What the stuck parts cover of the owner's foot: the tallest's room. */
  readonly footRoom = computed(() => Math.max(0, ...this.#feet().map((room) => room())));

  /** A part stuck to the owner's foot (the editor's floating foot) says how
      much it covers, until the returned function takes it back. */
  stickFoot(room: Signal<number>): () => void {
    this.#feet.update((feet) => [...feet, room]);
    return () => this.#feet.update((feet) => feet.filter((foot) => foot !== room));
  }
}
