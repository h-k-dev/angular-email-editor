import { Directive, ElementRef, inject } from '@angular/core';

/**
 * The toolbar's arrow keys (WAI-ARIA toolbar pattern): Left and Right move
 * focus between the tools, Home and End to the first and last. Only what
 * can be used counts — a disabled tool, one that has moved into the ⋯ menu
 * (`data-overflow`) or one the breakpoint hides is passed over.
 *
 * Not `@angular/aria`'s `ngToolbar`: its widgets own `tabindex`, `disabled`
 * and `aria-disabled` on their host, and so do `mat-icon-button` and
 * `ngMenuTrigger`, which the tools are — three directives writing one
 * attribute is a fight nobody wins. This keeps to the keys, and leaves the
 * attributes to the tools. Every tool stays a Tab stop.
 *
 * Applied as a host directive of the toolbar, or as `appToolbarKeys` on a
 * toolbar element of a template (the bubble menu's). A menu trigger's own
 * keys (Down, Enter, Space open it) are not among these, so the two never
 * meet. Left and Right follow the reading direction: in a right-to-left
 * toolbar, Left is the next tool.
 */
@Directive({ selector: '[appToolbarKeys]', host: { '(keydown)': 'onKeydown($event)' } })
export class ToolbarKeys {
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected onKeydown(event: KeyboardEvent): void {
    let step = STEPS[event.key];
    if (step === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
    if (typeof step === 'number' && getComputedStyle(this.#host).direction === 'rtl') step = -step as 1 | -1;
    const tools = this.#tools();
    const at = tools.indexOf(event.target as HTMLButtonElement);
    if (at < 0 || tools.length < 2) return;

    const to =
      step === 'first'
        ? 0
        : step === 'last'
          ? tools.length - 1
          : (at + step + tools.length) % tools.length;
    tools[to].focus();
    event.preventDefault();
  }

  /** The tools that can take focus, in reading order. */
  #tools(): HTMLButtonElement[] {
    return [...this.#host.querySelectorAll<HTMLButtonElement>('button')].filter(
      (tool) =>
        !tool.disabled &&
        !tool.hidden &&
        !tool.hasAttribute('data-overflow') &&
        !tool.closest('[hidden]') &&
        getComputedStyle(tool).display !== 'none',
    );
  }
}

const STEPS: Record<string, 1 | -1 | 'first' | 'last' | undefined> = {
  ArrowRight: 1,
  ArrowLeft: -1,
  Home: 'first',
  End: 'last',
};
