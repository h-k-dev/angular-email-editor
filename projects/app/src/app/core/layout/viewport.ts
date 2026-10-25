import { DOCUMENT, Service, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Observable, distinctUntilChanged, fromEvent, map, merge, of, startWith } from 'rxjs';

/** Below this the composer shows one pane at a time: the dock-out options
    (source beside the editor, preview beside the editor) leave the toolbar. */
export const DOCKING_MIN_WIDTH = 1200;

/** At this width and below the composer drops its flanks, its page padding
    and its corners: the writer takes the whole screen. Well under the docking
    breakpoint on purpose — between the two nothing can dock, but there is
    still room for the 600px sheet to sit centred between two gutters, and
    centred is where the sheet belongs. Only once the gutters stop paying for
    themselves — their two gaps are 32px of a 375px screen — does the writer
    latch to the full width. Inclusive, and mirrored by the padding and
    corner clamps in compose.scss / email-writer.scss: the CSS snaps in the
    paint the class arrives a frame after, so the two must agree on 768
    exactly or that one width renders a centred sheet with square corners. */
export const FULL_WIDTH_MAX_WIDTH = 768;

/** The room a phone gives its content, px — the widest phone held upright
    is 430px; this leaves it margin. Inclusive. What a part that lays itself
    out by its own width (a container query, `bp.phone-container`) calls a
    phone: never the viewport's {@link FULL_WIDTH_MAX_WIDTH}, which a narrow
    desk pane is under too. */
export const PHONE_CONTAINER_MAX = 480;

const NARROW = `(max-width: ${DOCKING_MIN_WIDTH - 0.02}px)`;
const COMPACT = `(max-width: ${FULL_WIDTH_MAX_WIDTH}px)`;
const TOUCH = '(hover: none) and (pointer: coarse)';

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

  /** No wider than {@link FULL_WIDTH_MAX_WIDTH}. */
  readonly compact = toSignal(
    this.#breakpoints.observe(COMPACT).pipe(map((state) => state.matches)),
    { initialValue: this.#breakpoints.isMatched(COMPACT) },
  );

  /** A finger is the main pointer — no hover, a coarse aim: a phone or a
      tablet, at any width. Not {@link compact}: a narrow desktop window
      still has a mouse. Where the platform's own touch scrolling stands in
      for what a mouse needs drawn (paddles, drag to scroll). */
  readonly touch = toSignal(
    this.#breakpoints.observe(TOUCH).pipe(map((state) => state.matches)),
    { initialValue: this.#breakpoints.isMatched(TOUCH) },
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

  /** The platform's scrollbars float over the content rather than standing
      beside it — macOS's, a phone's: they take no room and show only while
      a scroll is on, and how they show is the person's own setting. The
      shell hands this to the scroll mixin (`--email-scrollbars`), which then
      leaves the platform's bar alone. Measured, never sniffed: an unstyled
      probe's scrollbar, watched — a Mac set to follow its pointing device
      turns classic the moment a mouse is plugged in. */
  readonly floatingScrollbars = toSignal(floatingScrollbars(inject(DOCUMENT)), {
    requireSync: true,
  });
}

function floatingScrollbars(document: Document): Observable<boolean> {
  const body = document.body;
  if (!body || typeof ResizeObserver === 'undefined') return of(false);
  return new Observable<boolean>((subscriber) => {
    // A box that always scrolls, out of sight and out of the way, with no
    // scrollbar styling of its own: its scrollbar is the platform's. One
    // that floats takes nothing off the width; a classic one does, and
    // coming or going it resizes the filler, which is what is watched.
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:fixed;inset:0 auto auto 0;inline-size:100px;block-size:100px;' +
      'overflow:scroll;visibility:hidden;pointer-events:none;contain:strict';
    const filler = probe.appendChild(document.createElement('div'));
    body.append(probe);
    const measure = () => subscriber.next(probe.offsetWidth === probe.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(filler);
    return () => {
      observer.disconnect();
      probe.remove();
    };
  }).pipe(distinctUntilChanged());
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
