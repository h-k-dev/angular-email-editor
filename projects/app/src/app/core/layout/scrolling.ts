import { DOCUMENT, ElementRef, Provider, inject } from '@angular/core';
import {
  DEFAULT_SCROLL_TIME,
  ScrollDispatcher,
  ScrollDispatcherTarget,
} from '@angular/cdk/scrolling';
import { Observable, auditTime, fromEvent, merge, of, share } from 'rxjs';
import { filter, map } from 'rxjs/operators';

/**
 * The CDK's scroll dispatcher, hearing every scroll on the page. The CDK's
 * own hears the document's, and a container's only where it is marked
 * `cdkScrollable` — the app's panes, sheets and lists are not, so an
 * overlay over one stood still as it scrolled: a menu stayed open, a
 * popover drifted off its trigger. This one listens in the capture phase
 * too (a container's scroll does not bubble), so every container is heard,
 * marked or not, and named: the close strategy keeps a menu open while its
 * own list scrolls.
 */
export class EveryScrollDispatcher extends ScrollDispatcher {
  /** Every element's scroll, as the container that scrolled; one capture
      listener however many overlays hear it. */
  readonly #elements: Observable<ScrollDispatcherTarget> = fromEvent(inject(DOCUMENT), 'scroll', {
    capture: true,
    passive: true,
  }).pipe(
    map((event) => event.target),
    filter((target): target is HTMLElement => target instanceof HTMLElement),
    map((element) => {
      const ref = new ElementRef(element);
      return { getElementRef: () => ref, elementScrolled: () => of() };
    }),
    share(),
  );

  override scrolled(
    auditTimeInMs = DEFAULT_SCROLL_TIME,
  ): Observable<ScrollDispatcherTarget | void> {
    const elements =
      auditTimeInMs > 0 ? this.#elements.pipe(auditTime(auditTimeInMs)) : this.#elements;
    return merge(super.scrolled(auditTimeInMs), elements);
  }
}

/** Every overlay hears every scroll (`EveryScrollDispatcher`), for the app
    config. */
export function provideEveryScroll(): Provider {
  return { provide: ScrollDispatcher, useClass: EveryScrollDispatcher };
}
