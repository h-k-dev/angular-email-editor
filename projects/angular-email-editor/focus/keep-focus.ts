import { Directive, ElementRef, booleanAttribute, inject, input } from '@angular/core';

/** Where a press may still take focus by default: real text entry. A field
    inside a toolbar has to be typed in; everything else there is a tool. */
export const KEEP_FOCUS_EXCEPT =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * A press on this element never takes focus from wherever it is — the
 * editor keeps its caret and its selection while a toolbar button, a menu
 * row or a swatch is clicked, and whatever depends on the editor's focus (a
 * bubble menu, a suggestion list) stays open through the click.
 *
 * Behaviour only: it renders nothing and sets no attribute, so it goes on a
 * host's own elements — a Material button, an Aria toolbar, a CDK overlay's
 * panel — or into a host's own component through `hostDirectives`:
 *
 *     <div role="toolbar" emailKeepFocus> … <button mat-icon-button>…</button> … </div>
 *
 *     @Component({ …, hostDirectives: [KeepFocus] })
 *
 * One on a container covers everything in it: the press bubbles. Only the
 * pointer is kept out — Tab and the arrow keys still reach the tools, which
 * is what makes them usable from the keyboard — and only the press: the
 * click that follows runs as ever.
 *
 * It needs no editor: what keeps focus is whichever element has it, so the
 * same directive serves a composer's address rows.
 */
@Directive({
  selector: '[emailKeepFocus]',
  host: { '(mousedown)': 'onMousedown($event)' },
})
export class KeepFocus {
  /** Off with `[emailKeepFocus]="false"`; on by its presence. */
  readonly enabled = input(true, { alias: 'emailKeepFocus', transform: booleanAttribute });

  /** What inside this element may still take focus on a press — a selector.
      Text entry by default ({@link KEEP_FOCUS_EXCEPT}); `''` for nothing. */
  readonly except = input(KEEP_FOCUS_EXCEPT, { alias: 'emailKeepFocusExcept' });

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected onMousedown(event: MouseEvent): void {
    if (!this.enabled()) return;
    const except = this.except();
    const target = event.target as Element | null;
    // An exception counts inside this element only: standing in an editor's
    // contenteditable must not make every press here an exception.
    const excepted = except ? target?.closest?.(except) : null;
    if (excepted && this.#host.contains(excepted)) return;
    event.preventDefault();
  }
}
