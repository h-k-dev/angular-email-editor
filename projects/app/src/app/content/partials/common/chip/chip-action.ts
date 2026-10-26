import { Component, ElementRef, inject } from '@angular/core';

/**
 * The action of a COMPOSITE chip — the element that must stretch the chip
 * because something else shares it: a tab button beside a ✕ (dataset chips)
 * or beside a picker caret (the clickwork view switcher).
 *
 * ```html
 * <div chip>
 *   <button chipAction ngTab value="a">…</button>
 *   <button chipTrail …>✕</button>
 * </div>
 * ```
 *
 * The chip SHELL is not the tab: `role="tab"` makes its children
 * presentational and the tab list resolves clicks through
 * `closest('[role="tab"]')`, so a ✕ or a picker inside the tab would be both
 * unnamed and a tab switch. This element takes the chip's inset (the chip
 * drops its own padding once it holds one), so a click anywhere up to the
 * chip's edge lands here rather than on dead shell padding.
 *
 * A consumer tunes it like any host it styles — its own class on this
 * element out-specifies these rules (e.g. a smaller end inset beside a caret).
 */
@Component({
  selector: '[chipAction]',
  template: '<ng-content select="[chipLead]" /><span class="m-chip-action__label"><ng-content /></span>',
  styleUrl: './chip-action.scss',
  host: { class: 'm-chip-action' },
})
export class ChipAction {
  #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * A template ref on this element (`#tab`) resolves to THIS component, not
   * the element — so the one element call callers need is forwarded here.
   */
  focus(options?: FocusOptions): void {
    this.#host.nativeElement.focus(options);
  }
}
