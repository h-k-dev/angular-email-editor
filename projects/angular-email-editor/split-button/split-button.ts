import {
  Component,
  afterRenderEffect,
  booleanAttribute,
  contentChild,
  forwardRef,
  input,
} from '@angular/core';
import { SPLIT_BUTTON, SplitButtonLeading, SplitButtonTrailing } from './split-button-item';

/**
 * A button that can split: one action while there is one, and a second
 * half beside it when there is a second thing to do — Material 3's split
 * button, grown out of a plain icon button rather than always two.
 *
 * ```html
 * <hk-split-button aria-label="Attachments" [split]="count() > 0">
 *   <button hkSplitButtonLeading aria-label="Attach files" (click)="pick()">
 *     <mat-icon>attach_file</mat-icon>
 *   </button>
 *   <button hkSplitButtonTrailing aria-label="Attachments" [attr.aria-expanded]="shown()" (click)="toggle()">
 *     <mat-icon>expand_more</mat-icon>
 *   </button>
 * </hk-split-button>
 * ```
 *
 * **The container is the shape; the halves are the host's own buttons.**
 * Each half wears one attribute — `hkSplitButtonLeading`,
 * `hkSplitButtonTrailing` — and keeps everything a button has: content,
 * name, tooltip, click, `disabled`. Two buttons, two tab stops, in a
 * `group` the host names.
 *
 * **`split` is the morph.** Unsplit, the leading half is an icon button, as
 * it would be alone in a toolbar, and the trailing one has no width and is
 * `inert`. Split, the leading half widens, a gap opens between the two,
 * their inner corners go square and the trailing half opens out of the
 * leading one's side. Both stay icon buttons: nothing at rest, the state
 * layer — each in its own half shape — on hover, focus and press; a tonal
 * container is opt-in (`container-color`). The trailing half opens on a
 * grid track run from `0fr` to `1fr`, so to its content's width without a
 * number of ours. All of it CSS, still for reduced motion. Reflected as
 * `data-split` on the container and on both halves.
 *
 * **Focus never falls to the page.** When the container closes while the
 * trailing half has focus — its own click closed it — focus moves to the
 * leading half.
 *
 * **Themed as Material's icon button is.** Each half reads
 * `--hk-split-button-<name>`, then `--mat-icon-button-<name>`, then the
 * value Material's M3 icon button has — for `state-layer-size`,
 * `icon-size`, `touch-target-size`, `touch-target-display`,
 * `container-shape`, `icon-color`, `state-layer-color`,
 * `disabled-icon-color`, `disabled-state-layer-color` and the
 * `hover-`, `focus-` and `pressed-state-layer-opacity`. So it resizes with
 * the app's icon buttons (density, `mat.icon-button-overrides`) and is set
 * apart by ours. The split's own looks — `container-color`,
 * `split-icon-color`, `split-state-layer-color`,
 * `disabled-container-color`, `inner-container-shape`, `gap`,
 * `leading-split-width`, `trailing-width`, `duration`, `easing` — fall
 * back to Material's system tokens.
 *
 * **Each half has Material's touch target:** a box the touch target's size
 * centred on it, past the state layer. A press there is the half's.
 * Between the halves it reaches only to the middle of the gap, so the two
 * never overlap.
 *
 * **Hover is the button's, not a half's.** With the pointer anywhere in
 * either half's touch target, both halves' state layers come up together —
 * the two read as one control. A press and keyboard focus stay on the half
 * they are on, a step stronger; a disabled half stays dark.
 *
 * No Material, no icon font, no headless library.
 */
@Component({
  selector: 'hk-split-button',
  template: '<ng-content />',
  styleUrl: './split-button.scss',
  providers: [{ provide: SPLIT_BUTTON, useExisting: forwardRef(() => SplitButton) }],
  host: {
    role: 'group',
    '[attr.data-split]': 'split() || null',
    '(focusout)': 'onFocusout($event)',
  },
})
export class SplitButton {
  /** Two halves (true) or the leading one alone. */
  readonly split = input(false, { transform: booleanAttribute });

  protected readonly leading = contentChild(SplitButtonLeading);
  protected readonly trailing = contentChild(SplitButtonTrailing);

  constructor() {
    // Closed with focus still on the trailing half (the browser has not
    // taken it from the now inert half yet): hand it over.
    afterRenderEffect({
      write: () => {
        if (this.split()) return;
        const trailing = this.trailing()?.element;
        if (trailing?.contains(document.activeElement)) this.leading()?.focus();
      },
    });
  }

  /** Puts focus on the leading half. */
  focus(options?: FocusOptions): void {
    this.leading()?.focus(options);
  }

  /** The browser took focus from the trailing half as it went inert —
      `focusout` with nowhere to go: hand it to the leading half. */
  protected onFocusout(event: FocusEvent): void {
    if (this.split() || event.relatedTarget) return;
    const trailing = this.trailing()?.element;
    if (trailing?.contains(event.target as Node | null)) this.leading()?.focus();
  }
}
