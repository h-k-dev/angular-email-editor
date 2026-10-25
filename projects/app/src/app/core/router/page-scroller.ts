import { ViewportScroller } from '@angular/common';
import { DOCUMENT, DestroyRef, Directive, ElementRef, Service, inject } from '@angular/core';
import { NavigationSkipped, NavigationSkippedCode, Router } from '@angular/router';

/**
 * The router's scrolling (`withInMemoryScrolling`: a URL's #fragment
 * scrolled to, the place a back press returns to remembered) on the sheet
 * the page really scrolls in. Angular's own scroller only knows the window,
 * and in the mailbox the window never scrolls — its page does, beside the
 * aside (`[pageScroller]`). With no sheet attached (the landing) it is the
 * window again, as Angular's.
 *
 * Provided as the app's `ViewportScroller`, so the router needs nothing
 * else: forward navigations start at the top, a #fragment lands on its
 * element (CSS `scroll-margin` is its offset), back and forward land where
 * the page was left.
 *
 * One press it leaves alone: the back press that only closes something
 * over the page (`BackButton`'s guards are entries on the same URL). The
 * router reads that as a navigation to where it already is, and would put
 * the page back at its #fragment or its top under the window just closed.
 */
@Service()
export class PageScroller extends ViewportScroller {
  readonly #document = inject(DOCUMENT);
  readonly #window = this.#document.defaultView;
  readonly #router = inject(Router);

  /** The sheet the page scrolls in, while one is attached. */
  #sheet: HTMLElement | null = null;

  /** The next scroll belongs to a back press on the same URL: skipped. */
  #hold = false;

  constructor() {
    super();
    this.#router.events.subscribe((event) => {
      if (
        event instanceof NavigationSkipped &&
        event.code === NavigationSkippedCode.IgnoredSameUrlNavigation &&
        this.#router.currentNavigation()?.trigger === 'popstate'
      ) {
        this.#hold = true;
      }
    });
  }

  /** What the page scrolls in now: the attached sheet, or the document's
      own scroller. */
  get scroller(): HTMLElement {
    return this.#sheet ?? (this.#document.scrollingElement as HTMLElement);
  }

  /** The sheet the page scrolls in, from now on; the release hands the
      scrolling back to the window. */
  attach(sheet: HTMLElement): () => void {
    this.#sheet = sheet;
    return () => {
      if (this.#sheet === sheet) this.#sheet = null;
    };
  }

  /** Unused: a #fragment's offset is its element's `scroll-margin`. */
  override setOffset(): void {}

  override getScrollPosition(): [number, number] {
    if (this.#sheet) return [this.#sheet.scrollLeft, this.#sheet.scrollTop];
    return [this.#window?.scrollX ?? 0, this.#window?.scrollY ?? 0];
  }

  override scrollToPosition(position: [number, number], options?: ScrollOptions): void {
    if (this.#held()) return;
    const to = { ...options, left: position[0], top: position[1] };
    if (this.#sheet) this.#sheet.scrollTo(to);
    else this.#window?.scrollTo(to);
  }

  override scrollToAnchor(anchor: string, options?: ScrollOptions): void {
    if (this.#held()) return;
    const target =
      this.#document.getElementById(anchor) ?? this.#document.getElementsByName(anchor)[0];
    if (!target) return;
    // Whichever scrolls it into view — the sheet, or the window.
    target.scrollIntoView({ ...options, block: 'start' });
    // Where reading goes on from, as Angular's does; a heading takes it
    // with tabindex="-1".
    target.focus({ preventScroll: true });
  }

  override setHistoryScrollRestoration(scrollRestoration: 'auto' | 'manual'): void {
    try {
      if (this.#window) this.#window.history.scrollRestoration = scrollRestoration;
    } catch {
      // A sandboxed frame: the browser keeps its own.
    }
  }

  #held(): boolean {
    const held = this.#hold;
    this.#hold = false;
    return held;
  }
}

/** The sheet a page scrolls in — the router's scrolling happens here
    (`PageScroller`) while it is on the page. */
@Directive({ selector: '[pageScroller]' })
export class PageScrollerSheet {
  constructor() {
    // Released with the sheet.
    inject(DestroyRef).onDestroy(inject(PageScroller).attach(inject(ElementRef).nativeElement));
  }
}
