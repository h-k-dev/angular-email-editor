import { DOCUMENT, DestroyRef, inject } from '@angular/core';
import { darkModeEditorCss } from '@h-k-dev/angular-email-editor';
import { injectPalette } from '@h-k-dev/angular-email-editor/palette';

/** The sheets in the head, by their text — one per palette and scope, held
    for as long as a composer wears it (compose windows open side by side). */
const sheets = new Map<string, { element: HTMLStyleElement; users: number }>();

/**
 * The palette's dark variants on the editing surface under `scope`
 * (`darkModeEditorCss`): the paper in dark shows what Apple Mail shows of
 * the sent email — the same rules `emailDocument` writes into it. In an
 * injection context; the sheet leaves the head with its last composer.
 */
export function injectDarkPaletteStyle(scope: string): void {
  const css = darkModeEditorCss(scope, injectPalette());
  if (!css) return;
  const head = inject(DOCUMENT).head;
  let sheet = sheets.get(css);
  if (!sheet) {
    const element = head.ownerDocument.createElement('style');
    element.textContent = css;
    head.appendChild(element);
    sheet = { element, users: 0 };
    sheets.set(css, sheet);
  }
  sheet.users++;
  const held = sheet;
  inject(DestroyRef).onDestroy(() => {
    if (--held.users > 0) return;
    held.element.remove();
    sheets.delete(css);
  });
}
