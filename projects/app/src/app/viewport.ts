import { DOCUMENT, Service, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Observable, fromEvent, map, merge, of, startWith } from 'rxjs';

/** Below this the composer shows one pane at a time: the dock-out options
    (source beside the editor, preview beside the editor) leave the toolbar. */
export const DOCKING_MIN_WIDTH = 1200;

const NARROW = `(max-width: ${DOCKING_MIN_WIDTH - 0.02}px)`;

/** The viewport's breakpoints as signals — the CDK's BreakpointObserver,
    app-wide, so every page reads the same thresholds. */
@Service()
export class Viewport {
  readonly #breakpoints = inject(BreakpointObserver);

  /** Narrower than {@link DOCKING_MIN_WIDTH}. */
  readonly narrow = toSignal(
    this.#breakpoints.observe(NARROW).pipe(map((state) => state.matches)),
    { initialValue: this.#breakpoints.isMatched(NARROW) },
  );

  /** How much of the layout viewport the virtual keyboard covers, in px — 0
      on desktop, and 0 wherever the browser already shrinks the layout
      viewport for the keyboard (Chrome with interactive-widget=resizes-content,
      see index.html). iOS never does: there the visual viewport shrinks while
      the layout viewport stays, and this is the difference. The shell takes
      it off its height, so bottom-anchored chrome rides up above the keys. */
  readonly keyboardInset = toSignal(keyboardInset(inject(DOCUMENT).defaultView), {
    initialValue: 0,
  });
}

function keyboardInset(window: Window | null): Observable<number> {
  const viewport = window?.visualViewport;
  if (!window || !viewport) return of(0);
  return merge(fromEvent(viewport, 'resize'), fromEvent(viewport, 'scroll')).pipe(
    startWith(null),
    // Pinch-zoom also shrinks the visual viewport; that is not a keyboard.
    map(() =>
      viewport.scale === 1
        ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
        : 0,
    ),
  );
}
