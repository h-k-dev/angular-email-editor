import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { InteractivityChecker } from '@angular/cdk/a11y';
import { replyEnvelope, replyQuote } from '@h-k-dev/angular-email-editor';

import { BLANK } from './envelope';
import { ComposeWindows, MAX_MESSAGES } from './compose-windows';
import { DockStack, STACK_CLOSE_DELAY } from '../dock/dock-stack';
import { Viewport } from '../layout/viewport';
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

// A window's caret is placed by its focus trap (the CDK's initial focus),
// which takes only what is visible — and jsdom lays nothing out, so nothing
// has the geometry it looks for. The real check is a browser's.
beforeEach(() => {
  vi.spyOn(InteractivityChecker.prototype, 'isVisible').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

/** jsdom has no PointerEvent everywhere; a MouseEvent carries what the
    window reads (button, clientX) — its pointerId is the same `undefined`
    for every event of a gesture. */
const Pointer = (globalThis.PointerEvent ?? MouseEvent) as typeof MouseEvent;
const pointer = (target: Element, type: string, clientX: number) =>
  target.dispatchEvent(new Pointer(type, { clientX, button: 0, bubbles: true }));

describe('ComposeWindows', () => {
  let windows: ComposeWindows;
  let stack: DockStack;
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
    stack = TestBed.inject(DockStack);
    app = TestBed.inject(ApplicationRef);
    // Wide enough for the three a screen is ever allowed (3 × 616 + 16).
    screen(2000);
  });

  afterEach(() => {
    dock()?.remove();
    document.querySelector('[dock-stack-layer]')?.remove();
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
    screen(1700); // two places, both beside a stack too
    const first = await windows.open();
    await settle();
    const second = await windows.open();
    await settle();
    // Two fit at 1700: the second is a window of its own.
    expect(second).not.toBe(first);

    windows.minimize(first);
    await settle();
    // Minimized, the first gives its place up — so the next Compose is a
    // window of its own…
    const third = await windows.open();
    await settle();
    expect(third).not.toBe(first);
    expect(windows.windows()).toHaveLength(3);

    // …and with both places taken again, nothing new opens: the first
    // window comes off the stack, the oldest open one goes onto it in its
    // stead, and the first is in front, holding the caret.
    const again = await windows.open();
    await settle();
    expect(again).toBe(first);
    expect(windows.windows()).toHaveLength(3);
    const modeOf = (id: number) => windows.windows().find((w) => w.id === id)!.mode;
    expect(modeOf(first)).toBe('docked');
    expect(windows.minimized().map((w) => w.id)).toEqual([second]);
    expect(windows.front()).toBe(first);
    const oldest = frames()[0];
    expect(oldest.getAttribute('aria-labelledby')).toBe(`compose-window-title-${first}`);
    expect(oldest.contains(document.activeElement)).toBe(true);
  });

  it(`never holds more than ${MAX_MESSAGES} messages, open and stacked together`, async () => {
    const ids: number[] = [];
    for (let i = 0; i < MAX_MESSAGES; i++) {
      ids.push(await windows.open());
      windows.minimize(ids.at(-1)!);
    }
    await settle();
    expect(windows.minimized()).toHaveLength(MAX_MESSAGES);

    // The next Compose is the oldest message, back off the stack.
    expect(await windows.open()).toBe(ids[0]);
    expect(windows.windows()).toHaveLength(MAX_MESSAGES);
    expect(windows.minimized().map((w) => w.id)).not.toContain(ids[0]);
  });

  describe('the stack of minimized windows', () => {
    const stackOf = () =>
      frames()
        .filter((frame) => frame.hasAttribute('data-stacked'))
        .sort((a, b) => +a.dataset['stacked']! - +b.dataset['stacked']!);
    const counter = () => document.querySelector<HTMLButtonElement>('[dock-stack-counter]');
    const menu = () => document.querySelector<HTMLElement>('[dock-stack-menu]');
    const rows = () => [...document.querySelectorAll<HTMLElement>('.dock-stack-menu__row')];
    const nameOf = (row: Element) =>
      row.querySelector<HTMLButtonElement>('.dock-stack-menu__name')!;
    const placeOf = (id: number) => windows.windows().find((w) => w.id === id)!.slot;
    /** Names a window by its subject, as its title bar and the menu do. */
    const name = async (frame: Element, subject: string) => {
      const input = frame.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!;
      input.value = subject;
      input.dispatchEvent(new Event('input'));
      await settle();
    };

    it('beside open windows the edge shows only a counter, left of the leftmost one, counting every minimized window', async () => {
      const first = await windows.open();
      const second = await windows.open();
      const third = await windows.open();
      await settle();

      windows.minimize(second);
      await settle();
      // The row closes up over its place: the third moves in beside the
      // first. All the edge shows of the stack is its counter, left of the
      // leftmost window — the window itself is out of sight and out of
      // reach.
      expect(windows.windows().map((w) => w.mode)).toEqual(['docked', 'minimized', 'docked']);
      expect([placeOf(first), placeOf(third)]).toEqual([0, 1]);
      expect(stack.place()).toBe(1248);
      expect([stack.shown(), stack.hidden()]).toEqual([0, 1]);
      expect(counter()!.firstChild!.textContent!.trim()).toBe('1');
      expect(counter()!.getAttribute('aria-label')).toBe('Minimized: 1');
      expect(counter()!.closest('section[compose-window]')).toBeNull();
      expect(counter()!.classList).not.toContain('dock-stack-counter--beside');
      expect(counter()!.style.getPropertyValue('--dock-stack-x')).toBe('1248px');
      const [bar] = stackOf();
      expect(bar.hasAttribute('inert')).toBe(true);
      expect(bar.hasAttribute('data-stack-top')).toBe(false);
      // Folded: no menu.
      expect(menu()).toBeNull();

      windows.minimize(first);
      await settle();
      expect(windows.minimized().map((w) => w.id)).toEqual([first, second]);
      expect(stackOf().map((frame) => frame.dataset['stacked'])).toEqual(['0', '1']);
      // One window left, in the corner: the counter is beside it.
      expect(placeOf(third)).toBe(0);
      expect(stack.place()).toBe(632);
      expect(counter()!.firstChild!.textContent!.trim()).toBe('2');
      expect(stackOf().map((frame) => frame.hasAttribute('inert'))).toEqual([true, true]);

      // Restored, the second goes back between its neighbours' places: the
      // corner, the third being newer.
      windows.dock(second);
      await settle();
      expect([placeOf(second), placeOf(third)]).toEqual([0, 1]);
      expect(stack.place()).toBe(1248);
      expect(counter()!.firstChild!.textContent!.trim()).toBe('1');
    });

    it('with no window open the last one minimized stays on the edge, and the counter beside it counts the ones under it', async () => {
      const first = await windows.open();
      await settle();
      windows.minimize(first);
      await settle();
      // One minimized, none open: its bar, in the corner — never a counter
      // alone, and no counter with nothing under the bar.
      expect(stack.place()).toBe(16);
      expect([stack.shown(), stack.hidden()]).toEqual([1, 0]);
      expect(counter()).toBeNull();
      let [top] = stackOf();
      expect(top.hasAttribute('data-stack-top')).toBe(true);
      expect(top.hasAttribute('inert')).toBe(false);
      expect(top.style.getPropertyValue('--compose-window-x')).toBe('16px');
      expect(top.style.getPropertyValue('--dock-stack-counter')).toBe('');

      const second = await windows.open();
      const third = await windows.open();
      windows.minimize(second);
      windows.minimize(third);
      await settle();
      (document.activeElement as HTMLElement | null)?.blur();
      stack.fold(true);
      await settle();
      // Three minimized: the last on the edge, and the counter left of it
      // says two — what is under it.
      expect(windows.minimized().map((w) => w.id)).toEqual([third, second, first]);
      expect(counter()!.firstChild!.textContent!.trim()).toBe('2');
      expect(counter()!.getAttribute('aria-label')).toBe('More minimized: 2');
      expect(counter()!.classList).toContain('dock-stack-counter--beside');
      const bars = stackOf();
      [top] = bars;
      expect(bars.map((frame) => frame.hasAttribute('data-stack-top'))).toEqual([
        true,
        false,
        false,
      ]);
      expect(bars.map((frame) => frame.hasAttribute('inert'))).toEqual([false, true, true]);
      // The bar on the edge makes room for the counter.
      expect(top.style.getPropertyValue('--dock-stack-counter')).toBe('48px');

      // A window opens: the bar leaves the edge, and the counter counts
      // all three.
      await windows.open();
      await settle();
      expect(counter()!.firstChild!.textContent!.trim()).toBe('3');
      expect(stackOf().some((frame) => frame.hasAttribute('data-stack-top'))).toBe(false);
    });

    it('the counter opens a menu of the windows out of sight — one panel, the last minimized first — and Escape closes it', async () => {
      const first = await windows.open();
      const second = await windows.open();
      await windows.open();
      await settle();
      await name(frames()[0], 'Quarterly report');
      await name(frames()[1], 'Lunch?');
      windows.minimize(first);
      windows.minimize(second);
      await settle();
      expect(counter()!.getAttribute('aria-expanded')).toBe('false');

      counter()!.click(); // no pointer behind it: a key's click
      await settle();
      expect(stack.open()).toBe(true);
      expect(counter()!.getAttribute('aria-expanded')).toBe('true');
      // One panel in the stack's place, its rows named as the windows are.
      expect(menu()!.style.getPropertyValue('--dock-stack-x')).toBe('632px');
      expect(rows().map((row) => nameOf(row).textContent!.trim())).toEqual([
        'Lunch?',
        'Quarterly report',
      ]);
      expect(rows().every((row) => row.dataset['kind'] === 'compose')).toBe(true);
      // The windows themselves stay out of sight: the rows stand for them.
      expect(stackOf().map((frame) => frame.hasAttribute('inert'))).toEqual([true, true]);
      // A key's press takes the focus onto the first row.
      expect(document.activeElement).toBe(nameOf(rows()[0]));

      // A renamed window is renamed in the menu.
      await name(frames()[0], 'Q3 report');
      expect(nameOf(rows()[1]).textContent!.trim()).toBe('Q3 report');

      // Escape closes it, the focus back on the counter.
      nameOf(rows()[0]).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
      await settle();
      expect(stack.open()).toBe(false);
      expect(menu()).toBeNull();
      expect(document.activeElement).toBe(counter());
    });

    it('a pointer opens it, and it closes a moment after the pointer leaves — the menu is one piece, gaps and all', async () => {
      const first = await windows.open();
      const second = await windows.open();
      await windows.open();
      windows.minimize(first);
      windows.minimize(second);
      await settle();
      (document.activeElement as HTMLElement | null)?.blur();
      stack.fold(true);
      await settle();
      counter()!.dispatchEvent(new Event('pointerenter'));
      expect(stack.open()).toBe(true);
      await settle();
      vi.useFakeTimers();
      try {
        // Crossing from the counter to the menu keeps it open…
        counter()!.dispatchEvent(new Event('pointerleave'));
        vi.advanceTimersByTime(STACK_CLOSE_DELAY / 2);
        menu()!.dispatchEvent(new Event('pointerenter'));
        vi.advanceTimersByTime(STACK_CLOSE_DELAY * 4);
        // …and so does resting anywhere in it: the rows are in the panel,
        // and only leaving the panel is leaving.
        expect(stack.open()).toBe(true);
        expect(rows().every((row) => row.parentElement === menu())).toBe(true);

        menu()!.dispatchEvent(new Event('pointerleave'));
        vi.advanceTimersByTime(STACK_CLOSE_DELAY);
        expect(stack.open()).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a row restores its window into the row where its age puts it; its button closes it where it is', async () => {
      const first = await windows.open();
      const second = await windows.open();
      const third = await windows.open();
      windows.minimize(first);
      windows.minimize(second);
      await settle();
      // The third moved in to the corner meanwhile.
      expect(placeOf(third)).toBe(0);

      stack.fan();
      await settle();
      // The first is under the second on the stack: the second row.
      nameOf(rows()[1]).click();
      await settle();
      // The first is the older: the corner is its again, the third beside.
      expect(windows.windows().map((w) => [w.id, w.mode])).toEqual([
        [first, 'docked'],
        [second, 'minimized'],
        [third, 'docked'],
      ]);
      expect([placeOf(first), placeOf(third)]).toEqual([0, 1]);
      expect(windows.minimized().map((w) => w.id)).toEqual([second]);

      // The row's close button closes the window without bringing it back.
      rows()[0].querySelector<HTMLButtonElement>('.dock-stack-menu__close')!.click();
      await settle();
      expect(windows.windows().map((w) => w.id)).toEqual([first, third]);
      expect(stack.entries()).toEqual([]);
      expect(counter()).toBeNull();
      expect(menu()).toBeNull();
    });

    it('restored with no place free beside the stack, the oldest open window goes onto it in its stead', async () => {
      screen(1260); // two places — but only one beside a stack
      const first = await windows.open();
      const second = await windows.open();
      windows.minimize(first);
      windows.minimize(second);
      const third = await windows.open(); // the corner, free again
      await settle();
      expect(windows.minimized().map((w) => w.id)).toEqual([second, first]);

      windows.dock(first);
      await settle();
      // The second is still stacked, so one place is all the edge has: the
      // third, the oldest open window, makes room — and the first is back
      // in the corner.
      expect(windows.minimized().map((w) => w.id)).toEqual([third, second]);
      const restored = windows.windows().find((w) => w.id === first)!;
      expect([restored.mode, restored.slot]).toEqual(['docked', 0]);
    });

    it('takes room of its own: while anything is stacked, the edge may hold one window fewer', async () => {
      screen(1900); // three windows; three and the counter need 1920
      expect(windows.capacity()).toBe(3);
      expect(windows.capacity(true)).toBe(2);
      screen(1920);
      expect(windows.capacity(true)).toBe(3);
    });
  });

  it('a window writes: its layout blocks start static, and the settings turn them on', async () => {
    await windows.open();
    for (let i = 0; i < 4; i++) await settle();
    const frame = frames()[0];
    const editor = () => frame.querySelector<HTMLElement>('.ProseMirror')!;
    expect(editor().getAttribute('data-aee-static')).toBe(
      'section columns table spacer heading list',
    );

    // The settings' switch overrides the mode's default, for this message.
    // The settings dialog — this window's gear — is the overlay's.
    frame.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click();
    await settle();
    const dialog = document.querySelector<HTMLElement>('.message-settings-pane [role="dialog"]')!;
    expect(frame.contains(dialog)).toBe(false);
    // A page renders when it is first opened.
    [...dialog.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.textContent?.includes('Writer'))!
      .click();
    await settle();
    const layoutSwitch = dialog.querySelector<HTMLButtonElement>(
      '[data-setting="layout"] button[role="switch"]',
    )!;
    expect(layoutSwitch.getAttribute('aria-checked')).toBe('false');
    layoutSwitch.click();
    await settle();
    expect(editor().hasAttribute('data-aee-static')).toBe(false);
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

  it('the open windows stand from the corner in the order they were opened, with no gap between them', async () => {
    const first = await windows.open();
    const second = await windows.open();
    const third = await windows.open();
    await settle();
    const placeOf = (id: number) => windows.windows().find((w) => w.id === id)?.slot;
    const frameOf = (id: number) =>
      frames().find(
        (frame) => frame.getAttribute('aria-labelledby') === `compose-window-title-${id}`,
      )!;
    expect([placeOf(first), placeOf(second), placeOf(third)]).toEqual([0, 1, 2]);

    // The middle one closes: the newer one moves in over its place — and
    // slides there — while the older one, nearer the corner, stays put.
    const corner = windows.windows()[0];
    windows.close(second);
    await settle();
    expect([placeOf(first), placeOf(third)]).toEqual([0, 1]);
    expect(windows.windows()[0]).toBe(corner);
    expect(frameOf(third).style.getPropertyValue('--compose-window-x')).toBe('632px');
    expect(frameOf(third).classList).toContain('compose-window--sliding');
    expect(frameOf(first).classList).not.toContain('compose-window--sliding');

    // The next message is the newest: at the end of the row.
    const fourth = await windows.open();
    await settle();
    expect([placeOf(first), placeOf(third), placeOf(fourth)]).toEqual([0, 1, 2]);

    // The corner minimizes: everything newer moves in. Restored, it goes
    // back to the corner — only the order is kept — and they move out.
    windows.minimize(first);
    await settle();
    expect([placeOf(third), placeOf(fourth)]).toEqual([0, 1]);
    windows.dock(first);
    await settle();
    expect([placeOf(first), placeOf(third), placeOf(fourth)]).toEqual([0, 1, 2]);
    // Its own way back onto the edge is no slide; a drag is none either.
    expect(frameOf(first).classList).not.toContain('compose-window--sliding');
    expect(frameOf(third).classList).toContain('compose-window--sliding');
    windows.pinTo(third, 700);
    await settle();
    expect(frameOf(third).classList).not.toContain('compose-window--sliding');
  });

  it('each window is a message of its own, named by its subject', async () => {
    await windows.open();
    await windows.open();
    await settle();
    const [oldest, newest] = frames();

    const subject = newest.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!;
    subject.value = 'Lunch?';
    subject.dispatchEvent(new Event('input'));
    await settle();

    expect(titleOf(newest).textContent!.trim()).toBe('Lunch?');
    expect(titleOf(oldest).textContent!.trim()).toBe('New message');
    expect(frames().every((frame) => frame.getAttribute('role') === 'dialog')).toBe(true);
  });

  it('a window frames its rows in Material form fields: a Send held back marks the row, and says nothing', async () => {
    await windows.open();
    await settle();
    const [frame] = frames();
    const fields = [...frame.querySelectorAll('.writer-field mat-form-field')];
    // From, To and Subject — each control inside a field of its own.
    expect(fields.length).toBe(3);
    const to = fields.find((field) => field.querySelector('[placeholder="Recipients"]'))!;
    expect(to.classList).not.toContain('mat-form-field-invalid');

    [...frame.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Send')!.click();
    await settle();
    // The red line is the whole of it — iusta core's rows: no message.
    expect(to.classList).toContain('mat-form-field-invalid');
    expect(frame.querySelectorAll('mat-error, mat-hint')).toHaveLength(0);
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

  describe('what leaving would lose', () => {
    it('closeAll closes every window, the stacked ones too', async () => {
      const first = await windows.open();
      await windows.open();
      windows.minimize(first);
      await settle();
      expect(stack.entries()).toHaveLength(1);

      windows.closeAll();
      await settle();
      expect(windows.windows()).toEqual([]);
      expect(stack.entries()).toEqual([]);
      expect(frames()).toEqual([]);
    });
  });

  it('Ctrl+Shift+Enter in a row of the envelope fills its placeholders — the editor never sees that key there', async () => {
    await windows.open();
    await settle();
    const subject = frames()[0].querySelector<HTMLInputElement>('input[aria-label="Subject"]')!;
    subject.value = 'Hello {{ firstName }}';
    subject.dispatchEvent(new Event('input'));
    await settle();

    const key = new KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    subject.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    // The demo's evaluator answers after a small latency.
    for (let i = 0; i < 30 && subject.value !== 'Hello Ada'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle();
    }
    expect(subject.value).toBe('Hello Ada');
  });

  it('a fill started in the body — the editor’s own key there — fills the envelope with it', async () => {
    await windows.open({
      content: {
        message: { ...BLANK, subject: 'Hello {{ firstName }}', html: '<div>Dear {{ lastName }}</div>' },
        images: [],
      },
    });
    for (let i = 0; i < 4; i++) await settle();
    const frame = frames()[0];
    const subject = frame.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!;
    expect(subject.value).toBe('Hello {{ firstName }}');

    // The editor's own Mod-Shift-Enter, pressed in the body's text.
    const editor = frame.querySelector<HTMLElement>('.ProseMirror')!;
    editor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }),
    );
    for (let i = 0; i < 30 && subject.value !== 'Hello Ada'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await settle();
    }
    expect(subject.value).toBe('Hello Ada');
    expect(editor.textContent).toContain('Dear Lovelace');
  });

  it('Discard closes the window', async () => {
    await windows.open();
    await settle();
    frames()[0].querySelector<HTMLButtonElement>('[aria-label="Discard draft"]')!.click();
    await settle();
    expect(windows.windows()).toEqual([]);
  });

  describe('where the caret starts', () => {
    const inbound = {
      from: 'Ada Lovelace <ada@example.com>',
      to: 'you@example.com',
      subject: 'Launch checklist',
      html: '<p>Can you confirm?</p>',
    };
    const reply = () => ({
      message: {
        ...BLANK,
        ...replyEnvelope(inbound, 'reply', { self: BLANK.from }),
        quoted: replyQuote(inbound),
      },
      images: [],
    });
    /** Whatever the CDK's initial focus waits for — the editor mounting a
        render after the sheet — has happened. */
    const mounted = async () => {
      for (let i = 0; i < 4; i++) await settle();
    };

    it('a reply starts in the editor, marked cdkFocusInitial, its rows filled and its history kept', async () => {
      await windows.open({ content: reply(), focus: 'body' });
      await mounted();
      const frame = frames()[0];
      const editor = frame.querySelector<HTMLElement>('.ProseMirror')!;
      expect(frame.querySelector('section[email-compose]')!.hasAttribute('cdkFocusInitial')).toBe(
        true,
      );
      expect(document.activeElement).toBe(editor);
      // The caret is the editor's own selection: the empty line over the
      // history, ready to type on.
      expect(editor.firstElementChild?.textContent).toBe('');
      expect(frame.querySelector('.aee-quoted')).not.toBeNull();
      expect(frame.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!.value).toBe(
        'Re: Launch checklist',
      );
    });

    it('a new message — and a forward, with nobody to go to yet — starts in To', async () => {
      await windows.open({ content: reply(), focus: 'to' });
      await mounted();
      const frame = frames()[0];
      expect(frame.querySelector('[cdkFocusInitial]')?.hasAttribute('email-address-input')).toBe(
        true,
      );
      expect(document.activeElement?.closest('[email-address-input]')).not.toBeNull();
      expect(document.activeElement?.closest('.ProseMirror')).toBeNull();
    });
  });
});

describe('ComposeWindows on a phone', () => {
  const compact = signal(true);
  let windows: ComposeWindows;
  let app: ApplicationRef;

  const frame = () => document.querySelector<HTMLElement>('section[compose-window]');
  const settle = () => app.whenStable();
  /** The phone's back button. */
  const pressBack = async () => {
    history.back();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
  };
  /** Its forward button, which undoes that press. */
  const pressForward = async () => {
    history.forward();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await settle();
  };

  beforeEach(() => {
    compact.set(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: EMAIL_SEND_LATENCY, useValue: 0 },
        {
          provide: Viewport,
          useValue: {
            compact: compact.asReadonly(),
            narrow: compact.asReadonly(),
            touch: signal(false).asReadonly(),
            floatingScrollbars: signal(true).asReadonly(),
            keyboardInset: signal(0),
          },
        },
      ],
    });
    windows = TestBed.inject(ComposeWindows);
    app = TestBed.inject(ApplicationRef);
  });

  // Every window takes a history entry while it is open (the back guard):
  // close them all and let the browser rewind before the next spec, or the
  // entries pile up between them.
  afterEach(async () => {
    for (const open of [...windows.windows()]) windows.close(open.id);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 40));
    document.querySelector('[compose-dock]')?.remove();
  });

  it("opens as the page: no title bar, and none of a window's own controls", async () => {
    await windows.open();
    await settle();

    expect(frame()!.hasAttribute('data-bare')).toBe(true);
    expect(frame()!.querySelector('.compose-window__bar')).toBeNull();
    // Nothing names the window over itself any more, so it says its name.
    expect(frame()!.getAttribute('aria-label')).toBe('New message');
    expect(frame()!.getAttribute('aria-labelledby')).toBeNull();
    // No close, no minimize, no expand, and nothing on the message's bar
    // either: the back button is the way out and Discard is the way to throw
    // the message away.
    expect(frame()!.querySelector('[aria-label="Close"]')).toBeNull();
    expect(frame()!.querySelector('[aria-label="Discard draft"]')).not.toBeNull();
  });

  it('a window asked for keeps its title bar, phone or not', async () => {
    await windows.open({ mobile: 'window' });
    await settle();

    expect(frame()!.hasAttribute('data-bare')).toBe(false);
    expect(frame()!.querySelector('.compose-window__bar')).not.toBeNull();
    expect(frame()!.querySelector('[aria-label="Close"]')).not.toBeNull();
  });

  it('the back button closes the window instead of leaving the page', async () => {
    const here = location.href;
    await windows.open();
    await settle();

    await pressBack();
    expect(windows.windows()).toEqual([]);
    expect(location.href).toBe(here);

    // Closed some other way instead — Discard here: the guard goes with the
    // window, so the next press is the page's own again.
    await windows.open();
    await settle();
    frame()!.querySelector<HTMLButtonElement>('[aria-label="Discard draft"]')!.click();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(windows.windows()).toEqual([]);
    expect(history.state?.__backGuard).toBeUndefined();
  });

  it('a refresh over an open window leaves no mark to swallow the next press', async () => {
    // What a hard refresh on top of a window leaves behind: the entry still
    // claims a guard, of a page that is gone (see BackButton). The window
    // opened after it must still close on the first press.
    const entry = history.state;
    history.replaceState({ ...entry, __backGuard: 9, __backGuardLife: 'before the refresh' }, '');
    try {
      await windows.open();
      await settle();

      await pressBack();
      expect(windows.windows()).toEqual([]);
    } finally {
      // The entry every spec here starts from: leave it as found.
      history.replaceState(entry, '');
    }
  });

  it('the forward button brings the window back, with what was written in it', async () => {
    const id = await windows.open();
    await settle();
    const subject = () => frame()!.querySelector<HTMLInputElement>('input[aria-label="Subject"]')!;
    subject().value = 'Lunch?';
    subject().dispatchEvent(new Event('input'));
    await settle();

    await pressBack();
    expect(windows.windows()).toEqual([]);

    // The same message, in the same place, under the same name: a back
    // press is a step away from it, and the step is taken back.
    await pressForward();
    expect(windows.windows().map((w) => [w.id, w.slot])).toEqual([[id, 0]]);
    expect(subject().value).toBe('Lunch?');

    // And it is guarded again, on the very entry it came back on — no
    // second entry for the same window.
    const entries = history.length;
    await pressBack();
    expect(windows.windows()).toEqual([]);
    expect(history.length).toBe(entries);
  });

  it('closed by hand, the forward button has nothing to bring back', async () => {
    await windows.open();
    await settle();

    // Discard is closing it on purpose: the guard's entry goes with the
    // window, and the press that follows walks into nothing of ours.
    frame()!.querySelector<HTMLButtonElement>('[aria-label="Discard draft"]')!.click();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 40));

    await pressForward();
    expect(windows.windows()).toEqual([]);
  });

  it("on a desk the back button stays the page's own: no guard, no entry", async () => {
    compact.set(false);
    const entries = history.length;
    await windows.open();
    await settle();
    expect(history.length).toBe(entries);
  });
});
