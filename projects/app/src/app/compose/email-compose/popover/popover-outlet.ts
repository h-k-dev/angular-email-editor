import { Component, afterRenderEffect, computed, inject, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

// CDK
import { CdkConnectedOverlay, OverlayModule } from '@angular/cdk/overlay';

// Library
import { Anchor, AnchorRect } from 'angular-email-editor/anchor';

import { POPOVER_ABOVE, Popover } from './popover';

/** Equal boxes are no move: a menu state that re-measures an unmoved block
    on every transaction must not re-place the popover each time. */
const sameBox = (a: AnchorRect | null, b: AnchorRect | null): boolean =>
  a === b ||
  (!!a &&
    !!b &&
    a.left === b.left &&
    a.top === b.top &&
    (a.width ?? 0) === (b.width ?? 0) &&
    (a.height ?? 0) === (b.height ?? 0));

/**
 * The composer's one popover, rendered: a CDK overlay that is up while any
 * panel is (`Popover.shown`), holding that panel's content over that
 * panel's anchor. One anchor element, kept over whichever box is current;
 * one overlay, attached once and repositioned — never re-created — as the
 * panel, its box or its placement changes. The landing (the spring in the
 * stylesheet) plays when the popover comes up, and only then: a swap of
 * content, from the image's bubble to the text's or from the bubble to the
 * link editor, happens inside the box that is already there.
 *
 * The overlay's own Escape and click-outside are off (`disableClose`):
 * closing is each panel's, through its `open`, and a detach behind a
 * panel's back would leave it believing it is up. Keys and outside clicks
 * are forwarded to the panel that is up instead.
 */
@Component({
  selector: 'div[popover-outlet]',
  imports: [
    NgTemplateOutlet,

    // CDK
    OverlayModule,

    // Library
    Anchor,
  ],
  templateUrl: './popover-outlet.html',
  styleUrl: './popover-outlet.scss',
})
export class PopoverOutlet {
  readonly #popover = inject(Popover);

  /** The panel that is up, or null. */
  protected readonly shown = this.#popover.shown;

  protected readonly anchor = computed(() => this.shown()?.anchor() ?? null, { equal: sameBox });

  protected readonly positions = computed(() => this.shown()?.positions() ?? POPOVER_ABOVE);

  protected readonly content = computed(() => this.shown()?.content() ?? null);

  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly overlay = viewChild(CdkConnectedOverlay);

  constructor() {
    this.#popover.connect({ pane: () => this.overlay()?.overlayRef?.overlayElement ?? null });

    // The overlay does not watch its origin move: it measures on attach.
    // Whenever the panel, its box or its placement changes, the anchor takes
    // the new box in that render; then the overlay is told to look again —
    // measuring the origin and placing itself, both (hence the mixed phase).
    afterRenderEffect({
      mixedReadWrite: () => {
        this.shown();
        this.anchor();
        this.positions();
        const overlay = this.overlay()?.overlayRef;
        if (overlay?.hasAttached()) overlay.updatePosition();
      },
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    this.shown()?.onKeydown?.(event);
  }

  protected onOutsideClick(event: MouseEvent): void {
    this.shown()?.onOutsideClick?.(event);
  }
}
