import { Directive, ElementRef, inject, input, linkedSignal } from '@angular/core';

/** A box in viewport coordinates — a `DOMRect`, a menu state's
    `boundingBox`, a caret's `coordsAtPos`. A point when it has no size. */
export interface AnchorRect {
  left: number;
  top: number;
  width?: number;
  height?: number;
}

const NOWHERE: Required<AnchorRect> = { left: 0, top: 0, width: 0, height: 0 };

/**
 * A real element kept over a box the editor reports — a selection, a caret,
 * a block. The editor knows rectangles; everything that floats wants an
 * *element* to hold on to: the CDK's `cdkOverlayOrigin`, Material's
 * `matMenuTriggerFor`, Aria's menu trigger, CSS anchor positioning,
 * Floating UI. This is that element, so each of them works as it is:
 *
 *     <span [emailAnchor]="state().boundingBox" cdkOverlayOrigin #origin="cdkOverlayOrigin"></span>
 *     <ng-template cdkConnectedOverlay [cdkConnectedOverlayOrigin]="origin" …>
 *
 * Behaviour only: it places its element — fixed, at the box, out of the
 * pointer's way — and renders nothing. While the box is `null` it stays
 * where it last was, so what is anchored to it can close (and animate out)
 * in place rather than jump to the corner.
 *
 * The box is in viewport coordinates, so the element is `position: fixed`;
 * it must not sit inside a transformed ancestor, which would become its
 * frame. It does not follow a scroll by itself: it is as current as the box
 * it is given.
 */
@Directive({
  selector: '[emailAnchor]',
  exportAs: 'emailAnchor',
  host: {
    '[style.position]': '"fixed"',
    '[style.pointer-events]': '"none"',
    '[style.left.px]': 'box().left',
    '[style.top.px]': 'box().top',
    '[style.width.px]': 'box().width',
    '[style.height.px]': 'box().height',
  },
})
export class Anchor {
  /** The box to stand over; `null` while there is none. */
  readonly rect = input<AnchorRect | null | undefined>(null, { alias: 'emailAnchor' });

  /** The element itself — for what takes an element rather than a template
      reference (`#anchor="emailAnchor"`, then `anchor.element`). */
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The box being stood over: the last one given, held through `null`. */
  protected readonly box = linkedSignal<AnchorRect | null | undefined, Required<AnchorRect>>({
    source: this.rect,
    computation: (rect, previous) =>
      rect
        ? { left: rect.left, top: rect.top, width: rect.width ?? 0, height: rect.height ?? 0 }
        : (previous?.value ?? NOWHERE),
  });
}
