import { Component, inject } from '@angular/core';

import { DockStack } from '../../../../core/dock/dock-stack';
import { DockStackCounter } from './dock-stack-counter';
import { DockStackMenu } from './dock-stack-menu';

/**
 * The dock stack's own layer — mounted once by `DockStack` the first time
 * anything goes onto it, over the whole page and click-through. It holds
 * the stack's counter while the stack keeps anything out of sight, and its
 * menu while it is open.
 *
 * Under the windows' layers (z-index 900, the compose dock's) while the
 * stack is folded: the counter never meets a window, and a dialog's scrim
 * there covers it. Over them while it is open, with the menu. An app whose
 * windows stand elsewhere (`DOCK_STACK_HOST`) says where with
 * `--dock-stack-layer-z` and `--dock-stack-layer-open-z`.
 */
@Component({
  selector: 'div[dock-stack-layer]',
  imports: [DockStackCounter, DockStackMenu],
  template: `
    @if (stack.hidden()) {
      <button dock-stack-counter></button>
    }
    @if (stack.open()) {
      <div dock-stack-menu animate.enter="dock-stack-menu--enter"></div>
    }
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      z-index: var(--dock-stack-layer-z, 899);
      pointer-events: none;
    }

    :host(.dock-stack-layer--open) {
      z-index: var(--dock-stack-layer-open-z, 902);
    }
  `,
  host: {
    '[class.dock-stack-layer--open]': 'stack.open()',
  },
})
export class DockStackLayer {
  protected readonly stack = inject(DockStack);
}
