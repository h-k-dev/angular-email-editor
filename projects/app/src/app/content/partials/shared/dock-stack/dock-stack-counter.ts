import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,

  // Signals
  afterNextRender,
  computed,
  inject,
} from '@angular/core';

import { MatIcon } from '@angular/material/icon';

import { DockStack } from '../../../../core/dock/dock-stack';
import { I18n } from '../../../../core/translations/i18n';

/**
 * The dock stack's counter (`DockStack`): a pill on the bottom edge saying
 * how many minimized things the folded stack keeps out of sight — whatever
 * they are; it knows none of them.
 *
 * - Beside something open on the edge it stands in the stack's place, and
 *   is all the edge shows of the stack. With nothing open the stack's top
 *   bar is in that place, and the pill stands left of it, counting the
 *   ones under it.
 * - A pointer over it opens the stack's menu (`DockStackMenu`); a press
 *   does it for a touch, or a key — which takes the focus into the menu.
 *   Escape closes it.
 * - A bubble over the pill for each kind out of sight shows that kind's
 *   mark — a message's, a note's, an event's (`data-kind`, for its
 *   colour): what the one number counts.
 *
 * Whoever owns the layer on the edge renders it while the stack hides
 * anything: `@if (stack.hidden()) { <button dock-stack-counter></button> }`.
 */
@Component({
  selector: 'button[dock-stack-counter]',
  imports: [MatIcon],
  templateUrl: './dock-stack-counter.html',
  styleUrl: './dock-stack-counter.scss',
  host: {
    type: 'button',
    '[class.dock-stack-counter--beside]': 'stack.shown()',
    '[style.--dock-stack-x.px]': 'stack.place()',
    '[attr.aria-expanded]': 'stack.open()',
    '[attr.aria-label]': 'label()',
    '[title]': 'label()',
    '(pointerenter)': 'hover($event, true)',
    '(pointerleave)': 'hover($event, false)',
    '(focusout)': 'stack.fold()',
    '(keydown.escape)': 'stack.fold(true)',
    '(click)': 'toggle($event)',
  },
})
export class DockStackCounter {
  protected readonly stack = inject(DockStack);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #injector = inject(Injector);
  readonly #i18n = inject(I18n);

  /** What the counter says it counts: the minimized things — or, beside
      the stack's bar on the edge, the ones besides that. */
  protected readonly label = computed(() =>
    this.#i18n.t(this.stack.shown() ? 'dockStack.more' : 'dockStack.count', {
      count: this.stack.hidden(),
    }),
  );

  /** The kinds out of sight that have a mark: one bubble each, saying
      what the number counts — messages, notes, events. */
  protected readonly kinds = computed(() =>
    this.stack.hiddenKinds().filter((kind): kind is { kind: string; icon: string } => !!kind.icon),
  );

  constructor() {
    // Where the focus goes back to when the stack folds under it.
    this.stack.counter.set(this.#host);
    inject(DestroyRef).onDestroy(() => {
      if (this.stack.counter() === this.#host) this.stack.counter.set(null);
    });
  }

  /** A pointer over the counter fans the stack out, as over its bars. Not
      a touch: its press is the toggle, and fanning on the way in would have
      the press fold it straight back. */
  protected hover(event: PointerEvent, over: boolean): void {
    if (event.pointerType === 'touch') return;
    if (over) this.stack.fan();
    else this.stack.fold();
  }

  /** Pressed: the stack fans out, or folds. From a key (a click with no
      pointer behind it), the focus goes into the menu as it opens — onto
      its first row, the top of the stack. */
  protected toggle(event: MouseEvent): void {
    this.stack.toggle();
    if (event.detail !== 0 || !this.stack.open()) return;
    afterNextRender(
      {
        write: () =>
          this.#host.ownerDocument
            .querySelector<HTMLElement>('[dock-stack-menu] .dock-stack-menu__name')
            ?.focus(),
      },
      { injector: this.#injector },
    );
  }
}
