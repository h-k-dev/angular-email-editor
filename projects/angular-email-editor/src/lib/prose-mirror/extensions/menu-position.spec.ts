import { measureMenuPlacement } from './menu-position';

/**
 * A menu in a short scroll container, as a compose window has it: 380px of
 * editor on screen, the box 320px tall (the token's default), 4px from the
 * line. jsdom has no layout, so the geometry is set by hand.
 */
function mount(geometry: { scrollTop?: number; height?: number } = {}): HTMLElement {
  const container = document.createElement('div');
  const menu = document.createElement('div');
  container.appendChild(menu);
  container.getBoundingClientRect = () => new DOMRect(0, 100, 600, 380);
  Object.defineProperties(container, {
    clientHeight: { value: 380 },
    scrollWidth: { value: 600 },
    scrollLeft: { value: 0 },
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
    });
  });

  it('flips above when it overflows below and fits above, at full height', () => {
    // Below: 380 − 356 − 4 = 20px of room; above: 340 − 4 = 336px.
    expect(measureMenuPlacement(line(340), mount(), 4)).toEqual({
      left: 130,
      top: 340 - 4 - 320,
      maxHeight: null,
    });
  });

  it('fits neither side: above, shrunk to the room there, when above has more', () => {
    // The reported case — below 380 − 274 − 4 = 102px, above 258 − 4 = 254px.
    expect(measureMenuPlacement(line(258), mount(), 4)).toEqual({
      left: 130,
      top: 0,
      maxHeight: 254,
    });
  });

  it('fits neither side: below, shrunk to the room there, when below has more', () => {
    // Below 380 − 96 − 4 = 280px, above 80 − 4 = 76px.
    expect(measureMenuPlacement(line(80), mount(), 4)).toEqual({
      left: 130,
      top: 100,
      maxHeight: 280,
    });
  });

  it('counts the room in the visible part of a scrolled container', () => {
    // Scrolled 500px down: the same line sits at content y 758.
    expect(measureMenuPlacement(line(258), mount({ scrollTop: 500 }), 4)).toEqual({
      left: 130,
      top: 500,
      maxHeight: 254,
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
    });
  });

  it('stays below at full height when no side has room to shrink to', () => {
    // A line as tall as the view (an image's edge, say): 4px short on both sides.
    const tall = { left: 130, top: 90, bottom: 490 };
    expect(measureMenuPlacement(tall, mount(), 4)).toEqual({
      left: 130,
      top: 394,
      maxHeight: null,
    });
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
      });
    } finally {
      sheet.remove();
    }
  });
});
