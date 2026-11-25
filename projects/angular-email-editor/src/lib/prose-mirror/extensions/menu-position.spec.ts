import { measureMenuPlacement } from './menu-position';

/**
 * A menu in a short scroll container, as a compose window has it: 380px of
 * editor on screen, the box 320px tall (the token's default), 4px from the
 * line. jsdom has no layout, so the geometry is set by hand.
 */
function mount(
  geometry: { scrollTop?: number; height?: number; scrollLeft?: number; scrollWidth?: number } = {},
): HTMLElement {
  const container = document.createElement('div');
  const menu = document.createElement('div');
  container.appendChild(menu);
  container.getBoundingClientRect = () => new DOMRect(0, 100, 600, 380);
  Object.defineProperties(container, {
    clientHeight: { value: 380 },
    clientWidth: { value: 600 },
    scrollWidth: { value: geometry.scrollWidth ?? 600 },
    scrollLeft: { value: geometry.scrollLeft ?? 0 },
    scrollTop: { value: geometry.scrollTop ?? 0 },
  });
  Object.defineProperties(menu, {
    offsetWidth: { value: 240 },
    offsetHeight: { value: geometry.height ?? 320 },
  });
  return menu;
}

/** A caret line `top` px down the container's visible part, 16px high. */
const line = (top: number) => ({ left: 130, top: 100 + top, bottom: 100 + top + 16 });

describe('measureMenuPlacement', () => {
  it('goes below the line when it fits there, at full height', () => {
    expect(measureMenuPlacement(line(20), mount(), 4)).toEqual({
      left: 130,
      top: 40,
      maxHeight: null,
      side: 'below',
      anchorX: 0,
    });
  });

  it('flips above when it overflows below and fits above, at full height', () => {
    // Below: 380 − 356 − 4 = 20px of room; above: 340 − 4 = 336px.
    expect(measureMenuPlacement(line(340), mount(), 4)).toEqual({
      left: 130,
      top: 340 - 4 - 320,
      maxHeight: null,
      side: 'above',
      anchorX: 0,
    });
  });

  it('fits neither side: above, shrunk to the room there, when above has more', () => {
    // The reported case — below 380 − 274 − 4 = 102px, above 258 − 4 = 254px.
    expect(measureMenuPlacement(line(258), mount(), 4)).toEqual({
      left: 130,
      top: 0,
      maxHeight: 254,
      side: 'above',
      anchorX: 0,
    });
  });

  it('fits neither side: below, shrunk to the room there, when below has more', () => {
    // Below 380 − 96 − 4 = 280px, above 80 − 4 = 76px.
    expect(measureMenuPlacement(line(80), mount(), 4)).toEqual({
      left: 130,
      top: 100,
      maxHeight: 280,
      side: 'below',
      anchorX: 0,
    });
  });

  it('counts the room in the visible part of a scrolled container', () => {
    // Scrolled 500px down: the same line sits at content y 758.
    expect(measureMenuPlacement(line(258), mount({ scrollTop: 500 }), 4)).toEqual({
      left: 130,
      top: 500,
      maxHeight: 254,
      side: 'above',
      anchorX: 0,
    });
  });

  it('chooses its side by the height it is given, not one shrunk by a past cap', () => {
    // Rendered at the last cap (254px), the box would fit above exactly and
    // drop its cap — then grow back to 320px over the line.
    const menu = mount({ height: 254 });
    expect(measureMenuPlacement(line(258), menu, 4, 320)).toEqual({
      left: 130,
      top: 0,
      maxHeight: 254,
      side: 'above',
      anchorX: 0,
    });
  });

  it('stays below at full height when no side has room to shrink to', () => {
    // A line as tall as the view (an image's edge, say): 4px short on both sides.
    const tall = { left: 130, top: 90, bottom: 490 };
    expect(measureMenuPlacement(tall, mount(), 4)).toEqual({
      left: 130,
      top: 394,
      maxHeight: null,
      side: 'below',
      anchorX: 0,
    });
  });

  it('says where the caret stands across a box pushed in from the edge', () => {
    // A caret 100px from the right edge of a 600px-wide container: a 240px
    // box is pushed in to end at the edge, the caret 140px across it.
    expect(measureMenuPlacement({ left: 500, top: 120, bottom: 136 }, mount(), 4)).toMatchObject({
      left: 360,
      anchorX: 140,
      side: 'below',
    });
  });

  it('keeps to what is on screen across a container scrolled sideways, however wide it scrolls', () => {
    // An email wider than its paper: 600px on screen, scrolled 40px into
    // 656 — or into 900, once a box standing past the edge has widened it.
    // A caret 100px from the paper's right edge: the 240px box ends at that
    // edge (content x 640), never past it.
    for (const scrollWidth of [656, 900]) {
      expect(
        measureMenuPlacement(
          { left: 500, top: 120, bottom: 136 },
          mount({ scrollLeft: 40, scrollWidth }),
          4,
        ),
      ).toMatchObject({ left: 400, anchorX: 140 });
    }
    // …and a caret scrolled out past the left edge: the box starts at it.
    expect(
      measureMenuPlacement(
        { left: -30, top: 120, bottom: 136 },
        mount({ scrollLeft: 40, scrollWidth: 656 }),
        4,
      ),
    ).toMatchObject({ left: 40, anchorX: 0 });
  });

  it('keeps to what a scroller round the container shows across', () => {
    // An editor as wide as its email (1000px, not scrolled itself) inside a
    // 400px sheet that scrolls it sideways: a caret 20px from the sheet's
    // right edge pushes the 240px box in to end there.
    const sheet = document.createElement('div');
    sheet.style.overflowX = 'auto';
    sheet.getBoundingClientRect = () => new DOMRect(0, 100, 400, 380);
    Object.defineProperties(sheet, { clientLeft: { value: 0 }, clientWidth: { value: 400 } });
    const container = document.createElement('div');
    const menu = document.createElement('div');
    container.appendChild(menu);
    sheet.appendChild(container);
    document.body.appendChild(sheet);
    container.getBoundingClientRect = () => new DOMRect(0, 100, 1000, 380);
    Object.defineProperties(container, {
      clientHeight: { value: 380 },
      clientWidth: { value: 1000 },
      scrollLeft: { value: 0 },
      scrollTop: { value: 0 },
    });
    Object.defineProperties(menu, { offsetWidth: { value: 240 }, offsetHeight: { value: 320 } });
    try {
      expect(measureMenuPlacement({ left: 380, top: 120, bottom: 136 }, menu, 4)).toMatchObject({
        left: 160,
        anchorX: 220,
      });
    } finally {
      sheet.remove();
    }
  });

  it('counts only what is on screen when a scroller round the container clips it', () => {
    // An editor that grows with its text (2000px, not scrolled itself)
    // inside a sheet that scrolls: the sheet shows 100–480 of the window,
    // the editor starts 300px above the sheet's top. A line 300px down the
    // sheet has 60px of screen below it — not the editor's 1500.
    const sheet = document.createElement('div');
    sheet.style.overflowY = 'auto';
    sheet.getBoundingClientRect = () => new DOMRect(0, 100, 600, 380);
    Object.defineProperties(sheet, { clientTop: { value: 0 }, clientHeight: { value: 380 } });
    const container = document.createElement('div');
    const menu = document.createElement('div');
    container.appendChild(menu);
    sheet.appendChild(container);
    document.body.appendChild(sheet);
    container.getBoundingClientRect = () => new DOMRect(0, -200, 600, 2000);
    Object.defineProperties(container, {
      clientHeight: { value: 2000 },
      clientWidth: { value: 600 },
      scrollWidth: { value: 600 },
      scrollLeft: { value: 0 },
      scrollTop: { value: 0 },
    });
    Object.defineProperties(menu, { offsetWidth: { value: 240 }, offsetHeight: { value: 320 } });
    try {
      // The line at viewport 400: above 400 − 4 − 100 = 296px, below
      // 480 − 416 − 4 = 60px — neither fits 320: above, shrunk, from the
      // sheet's top (content y 300).
      expect(measureMenuPlacement(line(300), menu, 4)).toEqual({
        left: 130,
        top: 300,
        maxHeight: 296,
        side: 'above',
        anchorX: 0,
      });
    } finally {
      sheet.remove();
    }
  });
  it('leaves out what the scroller says its foot covers — a short box flips over the line, off the toolbar', () => {
    // A one-row box (56px) on a line 220px down: 380 − 240 = 140px below
    // on screen, but the floating foot covers the last 88 of them
    // (`scroll-padding-bottom`), which leaves 52 — so above it goes.
    const menu = mount({ height: 56 });
    menu.parentElement!.style.scrollPaddingBottom = '88px';
    expect(measureMenuPlacement(line(220), menu, 4)).toEqual({
      left: 130,
      top: 220 - 4 - 56,
      maxHeight: null,
      side: 'above',
      anchorX: 0,
    });
  });

  it('leaves out what a scroller round the container says is stuck at its top', () => {
    // An editor that grows with its text inside a sheet that scrolls; a bar
    // covers the sheet's top 48px (`scroll-padding-top`). A 300px box on a
    // line 330px down: 30px below it, 326 above — but only 278 of them
    // clear of the bar. It fits neither: above, shrunk to start under the
    // bar, never drawn beneath it. (Detached: jsdom's <body> has no height
    // and would clip everything.)
    const sheet = document.createElement('div');
    sheet.style.overflowY = 'auto';
    sheet.style.scrollPaddingTop = '48px';
    sheet.getBoundingClientRect = () => new DOMRect(0, 100, 600, 380);
    Object.defineProperties(sheet, { clientTop: { value: 0 }, clientHeight: { value: 380 } });
    const container = document.createElement('div');
    const menu = document.createElement('div');
    container.appendChild(menu);
    sheet.appendChild(container);
    container.getBoundingClientRect = () => new DOMRect(0, 100, 600, 2000);
    Object.defineProperties(container, {
      clientHeight: { value: 2000 },
      clientWidth: { value: 600 },
      scrollWidth: { value: 600 },
      scrollLeft: { value: 0 },
      scrollTop: { value: 0 },
    });
    Object.defineProperties(menu, { offsetWidth: { value: 240 }, offsetHeight: { value: 300 } });
    expect(measureMenuPlacement(line(330), menu, 4)).toEqual({
      left: 130,
      top: 48,
      maxHeight: 278,
      side: 'above',
      anchorX: 0,
    });
  });

  it('ignores scroll-padding on a non-scrolling container (`overflow: visible`)', () => {
    // Host-scroll mode (template designer, document sheet): the editor grows
    // (`overflow: visible`) and ends above the sticky foot; its own
    // `scroll-padding-bottom` must not be subtracted a second time.
    const menu = mount({ height: 56 });
    menu.parentElement!.style.overflowY = 'visible';
    menu.parentElement!.style.scrollPaddingBottom = '88px';
    // 380 − 240 = 140px below, not 52 — stays below.
    expect(measureMenuPlacement(line(220), menu, 4)).toEqual({
      left: 130,
      top: 240,
      maxHeight: null,
      side: 'below',
      anchorX: 0,
    });
  });

  describe('fixed (top-layer)', () => {
    /** Mounts a `position: fixed` menu inside a scroller at (0, 100, 600, 380). */
    const mountFixed = (
      opts: {
        height?: number;
        scrollPaddingBottom?: number;
        scrollerTop?: number;
        scrollerHeight?: number;
      } = {},
    ): HTMLElement => {
      const top = opts.scrollerTop ?? 100;
      const height = opts.scrollerHeight ?? 380;
      const scroller = document.createElement('div');
      scroller.style.overflowY = 'auto';
      if (opts.scrollPaddingBottom) {
        scroller.style.scrollPaddingBottom = `${opts.scrollPaddingBottom}px`;
      }
      scroller.getBoundingClientRect = () => new DOMRect(0, top, 600, height);
      Object.defineProperties(scroller, {
        clientTop: { value: 0 },
        clientLeft: { value: 0 },
        clientHeight: { value: height },
        clientWidth: { value: 600 },
      });
      const menu = document.createElement('div');
      menu.style.position = 'fixed';
      Object.defineProperties(menu, {
        offsetWidth: { value: 240 },
        offsetHeight: { value: opts.height ?? 320 },
      });
      scroller.appendChild(menu);
      return menu;
    };

    const withViewport = (width: number, height: number, run: () => void) => {
      const prevW = window.innerWidth;
      const prevH = window.innerHeight;
      Object.defineProperties(window, {
        innerWidth: { value: width, configurable: true },
        innerHeight: { value: height, configurable: true },
      });
      try {
        run();
      } finally {
        Object.defineProperties(window, {
          innerWidth: { value: prevW, configurable: true },
          innerHeight: { value: prevH, configurable: true },
        });
      }
    };

    it('flips above a floating foot when clear room above holds it', () => {
      withViewport(1200, 800, () => {
        // Scroller 100..480, floating foot covers bottom 88px (clearBottom = 392).
        // Line at 320..336: clearBelow = 392 − 340 = 52 (< 56), clearAbove = 316 − 100 = 216.
        const menu = mountFixed({ height: 56, scrollPaddingBottom: 88 });
        expect(measureMenuPlacement({ left: 130, top: 320, bottom: 336 }, menu, 4)).toEqual({
          left: 130,
          top: 320 - 4 - 56,
          maxHeight: null,
          side: 'above',
          anchorX: 0,
        });
      });
    });

    it('floats at full height over the footer toolbar when neither clear side holds it', () => {
      withViewport(1200, 800, () => {
        // Scroller 100..480 (380px), floating foot 88px (clearBottom = 392).
        // Line at 160..176: clearBelow = 212 (< 320), clearAbove = 56 (< 320),
        // but viewBelow = 792 − 180 = 612 (>= 320) — opens below at full height.
        const menu = mountFixed({ height: 320, scrollPaddingBottom: 88 });
        expect(measureMenuPlacement({ left: 130, top: 160, bottom: 176 }, menu, 4)).toEqual({
          left: 130,
          top: 180,
          maxHeight: null,
          side: 'below',
          anchorX: 0,
        });
      });
    });

    it('shrinks to whichever viewport side has more room when neither side of the viewport fits', () => {
      withViewport(600, 380, () => {
        // Viewport 8..372. Line at 260..276: viewBelow = 372 − 280 = 92, viewAbove = 256 − 8 = 248.
        const menu = mountFixed({ height: 320, scrollerTop: 0, scrollerHeight: 380 });
        expect(measureMenuPlacement({ left: 130, top: 260, bottom: 276 }, menu, 4)).toEqual({
          left: 130,
          top: 8,
          maxHeight: 248,
          side: 'above',
          anchorX: 0,
        });
      });
    });

    it('returns null when the caret has scrolled out of its scroller', () => {
      withViewport(1200, 800, () => {
        const menu = mountFixed({ height: 56 });
        expect(measureMenuPlacement({ left: 130, top: 60, bottom: 76 }, menu, 4)).toBeNull();
        expect(measureMenuPlacement({ left: 130, top: 500, bottom: 516 }, menu, 4)).toBeNull();
      });
    });
  });
});
