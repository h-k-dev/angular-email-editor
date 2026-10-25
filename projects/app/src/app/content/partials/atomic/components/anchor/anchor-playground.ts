import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Anchor, AnchorRect } from '@h-k-dev/angular-email-editor/anchor';

import { Playground, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** Over the selection, centred; under it when there is no room above. */
const POSITIONS: ConnectedPosition[] = [
  { originX: 'center', originY: 'top', overlayX: 'center', overlayY: 'bottom', offsetY: -8 },
  { originX: 'center', originY: 'bottom', overlayX: 'center', overlayY: 'top', offsetY: 8 },
];

/**
 * The anchor as a host uses it: a box the page reports (here, the text
 * selection's — an editor reports its own) made an element, so the CDK's
 * connected overlay can hang off it as off any button. Select words in the
 * paragraph: the anchor stands over them and the overlay follows. Collapse
 * the selection: the box is `null`, the anchor stays where it was, and the
 * overlay closes in place. `outline` draws the anchor's own box.
 */
@Component({
  selector: 'anchor-playground',
  imports: [PlaygroundFrame, PlaygroundSubject, Anchor, CdkOverlayOrigin, CdkConnectedOverlay],
  templateUrl: './anchor-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './anchor-playground.scss'],
  providers: [Playground],
})
export class AnchorPlayground {
  protected readonly playground = inject(Playground);

  readonly outline = signal(true);
  readonly overlay = signal(true);

  /** The selection's box in viewport coordinates, or null. */
  protected readonly rect = signal<AnchorRect | null>(null);
  protected readonly positions = POSITIONS;

  protected readonly text = viewChild.required<ElementRef<HTMLElement>>('text');

  protected readonly knobs = [
    knob.boolean('outline the anchor', this.outline),
    knob.boolean('connected overlay', this.overlay),
  ];

  constructor() {
    const document = inject(DOCUMENT);
    const onSelection = () => {
      const selection = document.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const inside = range && this.text().nativeElement.contains(range.commonAncestorContainer);
      const next = inside && !range.collapsed ? range.getBoundingClientRect() : null;
      const before = this.rect();
      if (!next && !before) return;
      const box = next
        ? {
            left: Math.round(next.left),
            top: Math.round(next.top),
            width: Math.round(next.width),
            height: Math.round(next.height),
          }
        : null;
      this.rect.set(box);
      if (!box !== !before) this.playground.log(box ? 'box' : 'box → null', box);
    };
    document.addEventListener('selectionchange', onSelection);
    inject(DestroyRef).onDestroy(() =>
      document.removeEventListener('selectionchange', onSelection),
    );
  }
}
