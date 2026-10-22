import {
  Component,
  Directive,
  ElementRef,
  HostAttributeToken,
  InjectionToken,
  Signal,
  forwardRef,
  inject,
} from '@angular/core';

/** What a half needs of the split button it stands in — `hk-split-button`
    provides it, so a half finds its container without importing it. */
export interface SplitButtonHost {
  readonly split: Signal<boolean>;
}

export const SPLIT_BUTTON = new InjectionToken<SplitButtonHost>('SplitButton');

/**
 * What both halves of an `hk-split-button` are — the container finds them
 * by this class. Use one of the two: `hkSplitButtonLeading` or
 * `hkSplitButtonTrailing`.
 *
 * A half is the host's own `<button>`: its content, its name, its click,
 * its `disabled` stay the host's. The half brings the shape and the motion,
 * and reflects the container's state as `data-split`. A `<button>` without
 * a `type` gets `type="button"`, so a half in a form never submits it.
 */
@Directive({
  host: {
    '[attr.type]': 'type',
    '[attr.data-split]': 'container.split() || null',
  },
})
export abstract class SplitButtonItem {
  protected readonly container = inject(SPLIT_BUTTON);

  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** `button` for a `<button>` the host gave no type; the host's own type
      otherwise, and none on any other element. */
  protected readonly type =
    this.element.tagName === 'BUTTON'
      ? (inject(new HostAttributeToken('type'), { optional: true }) ?? 'button')
      : null;

  focus(options?: FocusOptions): void {
    this.element.focus(options);
  }
}

/**
 * The leading half: the button's own action, always there. Unsplit it is a
 * plain icon button — a circle the state layer's size
 * (`--hk-split-button-state-layer-size`, else the icon button's),
 * transparent until hover; split, it widens a little and squares its
 * inner corners — still transparent until hover. Its content is the host's:
 * an icon, sized by `icon-size` — a `mat-icon` marked `inline`, an SVG at
 * 1em.
 *
 * ```html
 * <button hkSplitButtonLeading aria-label="Attach files"><mat-icon>attach_file</mat-icon></button>
 * ```
 *
 * A component on the host's element, not a directive: it brings its own
 * encapsulated look (`:host`), which nothing outside could give an element
 * the host wrote.
 */
@Component({
  selector: '[hkSplitButtonLeading]',
  exportAs: 'hkSplitButtonLeading',
  template: '<ng-content />',
  styleUrls: ['./split-button-item.scss', './split-button-leading.scss'],
  providers: [{ provide: SplitButtonItem, useExisting: forwardRef(() => SplitButtonLeading) }],
})
export class SplitButtonLeading extends SplitButtonItem {}

/**
 * The trailing half: the second action, there only while the container is
 * split. Unsplit it has no width and is `inert` — out of the tab order and
 * the accessibility tree — and it opens out of the leading half's side as
 * the container splits. Its content is the host's — an icon, a short count;
 * with none, a chevron pointing down (a menu's). Name it: `aria-label`, and
 * `aria-expanded` with `aria-controls` when it shows something.
 *
 * ```html
 * <button hkSplitButtonTrailing aria-label="Attachments" aria-expanded="true">
 *   <mat-icon>expand_more</mat-icon>
 * </button>
 * ```
 *
 * When the container closes while this half has focus, focus moves to the
 * leading half — never to the page.
 */
@Component({
  selector: '[hkSplitButtonTrailing]',
  exportAs: 'hkSplitButtonTrailing',
  templateUrl: './split-button-trailing.html',
  styleUrls: ['./split-button-item.scss', './split-button-trailing.scss'],
  providers: [{ provide: SplitButtonItem, useExisting: forwardRef(() => SplitButtonTrailing) }],
  host: {
    '[attr.inert]': "container.split() ? null : ''",
  },
})
export class SplitButtonTrailing extends SplitButtonItem {}
