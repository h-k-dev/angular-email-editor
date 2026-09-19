import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ComposeWindows } from './compose-windows';
import { EMAIL_SEND_LATENCY } from './email-send';

// jsdom lacks what the editor's text metrics need at mount (see
// compose.spec.ts): every window holds an editor.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;
HTMLCanvasElement.prototype.getContext = (() => ({
  font: '',
  measureText: (text: string) => ({ width: text.length * 7 }),
})) as never;
Element.prototype.setPointerCapture ??= () => {};

/** jsdom has no PointerEvent everywhere; a MouseEvent carries what the
    window reads (button, clientX) — its pointerId is the same `undefined`
    for every event of a gesture. */
const Pointer = (globalThis.PointerEvent ?? MouseEvent) as typeof MouseEvent;
const pointer = (target: Element, type: string, clientX: number) =>
  target.dispatchEvent(new Pointer(type, { clientX, button: 0, bubbles: true }));

describe('ComposeWindows', () => {
  let windows: ComposeWindows;
  let app: ApplicationRef;

  const dock = () => document.querySelector('[compose-dock]');
  const frames = () => [...document.querySelectorAll<HTMLElement>('section[compose-window]')];
  const titleOf = (frame: Element) =>
    frame.querySelector<HTMLButtonElement>('.compose-window__title')!;
  const settle = () => app.whenStable();

  /** The screen a spec runs on: how wide it is decides how many messages
      may be open (600 + 16 apiece, never more than three). */
  const realWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const screen = (width: number) => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: EMAIL_SEND_LATENCY, useValue: 0 }],
    });
    windows = TestBed.inject(ComposeWindows);
    app = TestBed.inject(ApplicationRef);
    // Wide enough for the three a screen is ever allowed (3 × 616 + 16).
    screen(2000);
  });

  afterEach(() => {
    dock()?.remove();
    if (realWidth) Object.defineProperty(window, 'innerWidth', realWidth);
  });

  it('holds as many messages as the screen fits, and never more than three', async () => {
    expect(windows.capacity()).toBe(3);
    screen(1400); // two whole windows, not three
    expect(windows.capacity()).toBe(2);
    screen(800); // one
    expect(windows.capacity()).toBe(1);
    screen(400); // less than one, but a message has to go somewhere
    expect(windows.capacity()).toBe(1);
    screen(4000); // however wide it gets, three
    expect(windows.capacity()).toBe(3);
  });

  it('opening past what the screen holds hands back the first window, with the caret in it', async () => {
    screen(1400);
    const first = await windows.open();
    await settle();
    const second = await windows.open();
    await settle();
    // Two fit at 1400: the second is a window of its own.
    expect(second).not.toBe(first);

    windows.minimize(first);
    await settle();
    const again = await windows.open();
    await settle();

    // Nothing new opened: the first window is back on the edge, in front,
    // and holding the caret.
    expect(again).toBe(first);
    expect(windows.windows()).toHaveLength(2);
    expect(windows.windows()[0].mode).toBe('docked');
    expect(windows.front()).toBe(first);
    const oldest = frames()[0];
    expect(oldest.getAttribute('aria-labelledby')).toBe(`compose-window-title-${first}`);
    expect(oldest.contains(document.activeElement)).toBe(true);
  });

  it('a narrow screen holds one message: the next Compose is that same message', async () => {
    screen(800);
    const first = await windows.open();
    await settle();
    expect(await windows.open()).toBe(first);
    expect(windows.windows()).toHaveLength(1);
  });

  it('mounts one dock on the first open, and gives each window a place of its own from the corner out', async () => {
    expect(dock()).toBeNull();
    const first = await windows.open();
    await settle();
    const second = await windows.open();
    await settle();

    expect(document.querySelectorAll('[compose-dock]')).toHaveLength(1);
    expect(windows.windows().map((w) => [w.id, w.slot])).toEqual([
      [first, 0],
      [second, 1],
    ]);
    // The place is worked out from its number, and the window is drawn
    // there — the corner first, then a window's width and a gap along.
    expect(frames().map((frame) => frame.getAttribute('data-slot'))).toEqual(['0', '1']);
    expect(frames().map((frame) => frame.style.getPropertyValue('--compose-window-x'))).toEqual([
      '16px',
      '632px',
    ]);
    // The newest window is the one on top, and the one with the caret.
    expect(windows.front()).toBe(second);
  });

  it('a window keeps its place while its neighbours come and go, and takes a free one back', async () => {
    const first = await windows.open();
    const second = await windows.open();
    const third = await windows.open();
    await settle();
    const placeOf = (id: number) => windows.windows().find((w) => w.id === id)?.slot;
    expect([placeOf(first), placeOf(second), placeOf(third)]).toEqual([0, 1, 2]);

    // The middle one closes: nothing shuffles.
    windows.close(second);
    await settle();
    expect([placeOf(first), placeOf(third)]).toEqual([0, 2]);

    // The next message takes the place that was given up.
    const fourth = await windows.open();
    await settle();
    expect(placeOf(fourth)).toBe(1);
    expect([placeOf(first), placeOf(third)]).toEqual([0, 2]);
  });

  it('each window is a message of its own, named by its subject', async () => {
    await windows.open();
    await windows.open();
    await settle();
    const [oldest, newest] = frames();

    const subject = newest.querySelector<HTMLInputElement>('input[id^="message-subject-"]')!;
    subject.value = 'Lunch?';
    subject.dispatchEvent(new Event('input'));
    await settle();

    expect(titleOf(newest).textContent!.trim()).toBe('Lunch?');
    expect(titleOf(oldest).textContent!.trim()).toBe('New message');
    expect(frames().every((frame) => frame.getAttribute('role') === 'dialog')).toBe(true);
  });

  it('the dialog and back leaves every window exactly where it was, dragged or not', async () => {
    const first = await windows.open();
    const second = await windows.open();
    await settle();
    windows.pinTo(first, 900);
    await settle();
    const places = () =>
      frames().map((frame) => [
        frame.getAttribute('data-slot'),
        frame.style.getPropertyValue('--compose-window-x'),
      ]);
    const before = places();
    expect(before).toEqual([
      ['0', '900px'], // dragged: pinned where it was put
      ['1', '632px'], // its own place
    ]);

    windows.expand(second);
    await settle();
    // The other window has not moved for the dialog.
    expect(places()[0]).toEqual(['0', '900px']);

    windows.collapse();
    await settle();
    expect(places()).toEqual(before);
    expect(windows.windows().map((w) => w.mode)).toEqual(['docked', 'docked']);
  });

  it('the title bar minimizes and restores; minimized, the sheet stays mounted', async () => {
    const id = await windows.open();
    await settle();
    const [frame] = frames();

    titleOf(frame).click();
    await settle();
    expect(windows.windows()[0].mode).toBe('minimized');
    expect(frame.getAttribute('data-mode')).toBe('minimized');
    expect(titleOf(frame).getAttribute('aria-expanded')).toBe('false');
    expect(frame.querySelector('[message-form]')).not.toBeNull();

    titleOf(frame).click();
    await settle();
    expect(windows.windows().find((w) => w.id === id)!.mode).toBe('docked');
  });

  it('expands into a modal dialog over a scrim, one at a time; the scrim and Escape bring it back', async () => {
    const first = await windows.open();
    const second = await windows.open();
    windows.expand(first);
    await settle();

    expect(windows.expanded()?.id).toBe(first);
    const scrim = document.querySelector<HTMLElement>('.compose-dock__scrim')!;
    expect(scrim).not.toBeNull();
    const dialog = frames().find((frame) => frame.getAttribute('data-mode') === 'expanded')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    // Another one expanding sends the first back to the edge.
    windows.expand(second);
    expect(windows.windows().map((w) => w.mode)).toEqual(['docked', 'expanded']);

    scrim.click();
    await settle();
    expect(windows.expanded()).toBeNull();
    expect(document.querySelector('.compose-dock__scrim')).toBeNull();

    windows.expand(second);
    await settle();
    const expanded = frames().find((frame) => frame.getAttribute('data-mode') === 'expanded')!;
    expanded.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(windows.expanded()).toBeNull();
  });

  it('the title bar drags the window along the edge, pinning it, never off the screen', async () => {
    const id = await windows.open();
    await settle();
    const [frame] = frames();
    const bar = frame.querySelector<HTMLElement>('.compose-window__bar')!;
    // A 600px window sitting in the corner of a 1200px screen: its right
    // side is 16px from the screen's, and it may be pinned as far as 584px
    // from it (left edge on the other margin).
    frame.getBoundingClientRect = () => ({ left: 584, right: 1184, width: 600 }) as DOMRect;
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 1200,
    });
    const pin = () => windows.windows().find((w) => w.id === id)!.pin;

    try {
      expect(pin()).toBeNull(); // in its own place until dragged
      pointer(bar, 'pointerdown', 700);
      pointer(bar, 'pointermove', 698);
      expect(pin()).toBeNull(); // under the threshold: still a click
      pointer(bar, 'pointermove', 600);
      expect(pin()).toBe(116); // dragged 100px left of the corner
      pointer(bar, 'pointermove', -2000);
      expect(pin()).toBe(584);
      pointer(bar, 'pointermove', 5000);
      expect(pin()).toBe(16);
      pointer(bar, 'pointerup', 5000);
      await settle();
      expect(frame.style.getPropertyValue('--compose-window-x')).toBe('16px');

      // A drag starting on the window's buttons is no drag.
      const close = frame.querySelector<HTMLElement>('[data-slot="controls"] button')!;
      pointer(close, 'pointerdown', 500);
      pointer(bar, 'pointermove', 100);
      expect(pin()).toBe(16);
    } finally {
      delete (document.documentElement as { clientWidth?: number }).clientWidth;
    }
  });

  it('closing hands focus back to where it was when the window opened', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    try {
      const id = await windows.open();
      await settle();
      expect(document.activeElement).not.toBe(opener);

      frames()[0].querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click();
      await settle();
      expect(windows.windows().some((w) => w.id === id)).toBe(false);
      expect(frames()).toHaveLength(0);
      expect(document.activeElement).toBe(opener);
    } finally {
      opener.remove();
    }
  });

  it('Discard closes the window', async () => {
    await windows.open();
    await settle();
    frames()[0].querySelector<HTMLButtonElement>('[aria-label="Discard draft"]')!.click();
    await settle();
    expect(windows.windows()).toEqual([]);
  });
});
