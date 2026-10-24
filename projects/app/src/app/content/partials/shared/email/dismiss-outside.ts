import { DOCUMENT, Signal, effect, inject } from '@angular/core';

/**
 * Closes a popover on a press outside it — a press, not a click: the click
 * that *opens* a popover (a button's mouseup, a bubble menu button) ends
 * after the popover is on screen, and to a click-based outside test that
 * very click is outside it, so the popover would close as it opens. A press
 * that began before the popover opened is never outside it: the listener
 * is only there while it is open. The press itself goes on as usual — a
 * caret in the text, a field, a button — so nothing covers the page and
 * nothing opens in the popover's place.
 *
 * Call in an injection context. `pane` is the popover's own element (the
 * overlay pane), read when a press comes.
 */
export function dismissOnPressOutside(
  open: Signal<boolean>,
  pane: () => HTMLElement | null | undefined,
  dismiss: () => void,
): void {
  const document = inject(DOCUMENT);
  effect((onCleanup) => {
    if (!open()) return;
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && pane()?.contains(target)) return;
      dismiss();
    };
    document.addEventListener('pointerdown', onPress, true);
    onCleanup(() => document.removeEventListener('pointerdown', onPress, true));
  });
}
