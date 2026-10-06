import { ElementRef, Signal, effect, inject } from '@angular/core';
import type { Editor } from 'angular-email-editor';

/**
 * The chat input's motion — the part of it CSS alone cannot carry. The
 * stylesheet owns the picture (the `height` transition, its duration and
 * easing on `--email-chat-input-motion`, reduced motion turning it off);
 * this file owns the number it runs to.
 *
 * A height only transitions between lengths, never to or from `auto` — so
 * the text's own height is measured and the box's written in pixels, the
 * way ChatGPT's composer does it. A layout transition: run on the main
 * thread, smooth with GPU acceleration off.
 */

/**
 * Keeps the host's `--email-chat-input-height` on the text's height plus
 * the host's padding and border, from a `ResizeObserver` on the editor.
 * Written straight to the host in the observer — before the frame paints,
 * so the transition starts with the line, not a frame behind it. The text
 * sizes itself, capped and scrolling on its own (the stylesheet), so the
 * box never scrolls: no scrollbar flashing while it catches up. Nothing on
 * the server, nor where there is no `ResizeObserver` — the box is `auto`.
 *
 * Call in an injection context, on the chat input's host.
 */
export function followTextHeight(editor: Signal<Editor | null>): void {
  const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  effect((onCleanup) => {
    const current = editor();
    if (!current || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(([entry]) => {
      const text = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
      const style = getComputedStyle(host);
      const frame =
        parseFloat(style.paddingTop) +
        parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth);
      host.style.setProperty('--email-chat-input-height', `${text + frame}px`);
    });
    observer.observe(current.view.dom);
    onCleanup(() => observer.disconnect());
  });
}
