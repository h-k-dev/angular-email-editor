import { Component, ElementRef, afterRenderEffect, inject, signal } from '@angular/core';

import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';

import { DockStack, DockStackEntry } from '../../../../core/dock/dock-stack';
import { I18n } from '../../../../core/translations/i18n';

/**
 * The dock stack's menu (`DockStack`): the minimized things the folded
 * stack keeps out of sight, as a list over its counter — the last one
 * minimized nearest it. One panel with nothing behind its rows: it takes
 * the pointer across the gaps between them (crossing a gap never leaves
 * the menu), and it scrolls — the wheel, a touch, the keys — once the
 * stack is longer than the screen has room for, fading out at whichever
 * end has more.
 *
 * A row is a bar as a minimized window's is: its kind's mark, its name —
 * pressed, it comes back — and a close button. The rows are the stack's
 * own; the things they stand for stay where they are, out of sight.
 */
@Component({
  selector: 'div[dock-stack-menu]',
  imports: [MatIcon, MatIconButton, TranslatePipe],
  templateUrl: './dock-stack-menu.html',
  styleUrl: './dock-stack-menu.scss',
  host: {
    role: 'group',
    '[attr.aria-label]': "i18n.t('dockStack.menu')",
    '[class.dock-stack-menu--beside]': 'stack.shown()',
    '[style.--dock-stack-x.px]': 'stack.place()',
    '(pointerenter)': 'stack.fan()',
    '(pointerleave)': 'stack.fold()',
    '(focusin)': 'stack.fan()',
    '(focusout)': 'stack.fold()',
    '(keydown.escape)': 'escape($event)',
    '[attr.data-more-above]': 'above() || null',
    '[attr.data-more-below]': 'below() || null',
    '(scroll)': 'measure()',
  },
})
export class DockStackMenu {
  protected readonly stack = inject(DockStack);
  protected readonly i18n = inject(I18n);

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** Whether there are rows scrolled out over the top of the panel, and
      under its foot: the panel fades out at that end, to say so. */
  protected readonly above = signal(false);
  protected readonly below = signal(false);

  constructor() {
    // As the list grows or shrinks, as well as when it scrolls.
    afterRenderEffect(() => {
      this.stack.hiddenEntries();
      this.measure();
    });
  }

  /** Where the scroller is. It rests on its foot (column-reverse), so its
      scrollTop is 0 there and goes negative up the stack. */
  protected measure(): void {
    const { scrollTop, scrollHeight, clientHeight } = this.#host;
    this.below.set(scrollTop < -1);
    this.above.set(scrollHeight - clientHeight + scrollTop > 1);
  }

  /** What a row says: its entry's name, as the thing itself gives it. */
  protected label(entry: DockStackEntry): string {
    return this.stack.labelOf(entry.key) ?? entry.key;
  }

  /** Escape closes the menu, and the focus goes back to the counter. */
  protected escape(event: Event): void {
    event.preventDefault();
    this.stack.fold(true);
    this.stack.counter()?.focus();
  }
}
