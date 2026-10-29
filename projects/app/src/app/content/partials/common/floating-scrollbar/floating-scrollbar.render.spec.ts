/**
 * The floating scrollbar in real Chromium — `npm run test:render` (jsdom has
 * no layout): where the platform's bars float it stays out of the way; where
 * they are classic it hides the platform's and draws thumbs over the
 * scroller — down its end edge, across its foot — that show on a scroll,
 * follow it, drag, and fade.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Viewport } from '../../../../core/layout/viewport';
import { FLOATING_SCROLLBAR_LINGER, FloatingScrollbar } from './floating-scrollbar';

@Component({
  imports: [FloatingScrollbar],
  template: `<div style="position: relative">
    <div class="pane" floatingScrollbar style="height: 200px; overflow-y: auto">
      <div style="height: 1000px"></div>
    </div>
  </div>`,
})
class Host {}

/** A component's own scroller, named from outside (the library's suggestion
    menu's list) — standing high, and styled with a gutter of its own. */
@Component({
  imports: [FloatingScrollbar],
  template: `<div
    class="menu"
    floatingScrollbar=".list"
    style="position: absolute; z-index: 10; inset: 0 auto auto 0; width: 240px"
  >
    <div class="list" style="position: relative; z-index: 3; height: 200px; overflow-y: auto; scrollbar-gutter: stable">
      <div style="height: 1000px"></div>
    </div>
  </div>`,
})
class InnerHost {}

describe('FloatingScrollbar on a scroller inside its host (render)', () => {
  it('hides that scroller’s bar, gutter and all, and draws one over it, above it', async () => {
    const styles = document.createElement('style');
    styles.textContent = `
      [data-floating-scrollbar='drawn'] { scrollbar-width: none !important; scrollbar-gutter: auto !important; }
      .floating-scrollbar { position: absolute; }
    `;
    document.head.appendChild(styles);
    TestBed.configureTestingModule({
      providers: [{ provide: Viewport, useValue: { floatingScrollbars: signal(false) } }],
    });
    const fixture = TestBed.createComponent(InnerHost);
    document.body.append(fixture.nativeElement);
    await fixture.whenStable();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const root = fixture.nativeElement as HTMLElement;
    const menu = root.querySelector<HTMLElement>('.menu')!;
    const list = root.querySelector<HTMLElement>('.list')!;
    // The attribute on the scroller it names, not on the host.
    expect(menu.hasAttribute('data-floating-scrollbar')).toBe(false);
    expect(list.getAttribute('data-floating-scrollbar')).toBe('drawn');
    expect(list.offsetWidth - list.clientWidth).toBe(0);
    const bar = list.nextElementSibling as HTMLElement;
    expect(bar.className).toBe('floating-scrollbar');
    list.scrollTop = 300;
    list.dispatchEvent(new Event('scroll'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(bar.getBoundingClientRect().toJSON()).toEqual(list.getBoundingClientRect().toJSON());
    expect(getComputedStyle(bar).zIndex).toBe('4');
    root.remove();
    styles.remove();
  });
});

/** A scroller that runs on both ways: a table wider than it, and taller —
    a stuck foot over its end (the composer's toolbar), said by its block
    scroll padding. */
@Component({
  imports: [FloatingScrollbar],
  template: `<div style="position: relative">
    <div class="pane" floatingScrollbar style="width: 400px; height: 200px; overflow: auto; scroll-padding-block-end: 40px">
      <div style="width: 2000px; height: 1000px"></div>
    </div>
  </div>`,
})
class BothWaysHost {}

describe('FloatingScrollbar across (render)', () => {
  let fixture: ComponentFixture<BothWaysHost>;
  let styles: HTMLStyleElement;

  const pane = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.pane')!;
  const bar = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.floating-scrollbar')!;
  const down = () => bar().querySelector<HTMLElement>('[data-axis="block"]')!;
  const across = () => bar().querySelector<HTMLElement>('[data-axis="inline"]')!;
  const thumb = () => across().querySelector<HTMLElement>('.floating-scrollbar__thumb')!;
  const offset = () => new DOMMatrix(getComputedStyle(thumb()).transform).m41;
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const scrollAcross = async (left: number) => {
    pane().scrollLeft = left;
    pane().dispatchEvent(new Event('scroll'));
    await frame();
  };

  beforeEach(async () => {
    // The geometry of _floating-scrollbar.scss, without its look.
    styles = document.createElement('style');
    styles.textContent = `
      [data-floating-scrollbar='drawn'] { scrollbar-width: none; }
      .floating-scrollbar, .floating-scrollbar__rail, .floating-scrollbar__thumb { position: absolute; }
      [data-axis='block'].floating-scrollbar__rail { inset-block: 2px calc(var(--_cover-end, 0px) + 2px); inset-inline-end: 0; inline-size: 12px; }
      [data-axis='inline'].floating-scrollbar__rail { inset-block-end: var(--email-scroll-across-end, var(--_cover-end, 0px)); inset-inline: 2px 14px; block-size: 12px; }
      [data-axis='inline'] > .floating-scrollbar__thumb { inset-inline-start: 0; inset-block-end: 2px; block-size: 6px; }
    `;
    document.head.appendChild(styles);
    TestBed.configureTestingModule({
      providers: [{ provide: Viewport, useValue: { floatingScrollbars: signal(false) } }],
    });
    fixture = TestBed.createComponent(BothWaysHost);
    document.body.append(fixture.nativeElement);
    await fixture.whenStable();
    await frame();
  });

  afterEach(() => {
    (fixture.nativeElement as HTMLElement).remove();
    styles.remove();
  });

  it('hides the platform’s bar both ways, and draws one across the foot', () => {
    expect(pane().offsetHeight - pane().clientHeight).toBe(0);
    expect(pane().offsetWidth - pane().clientWidth).toBe(0);
    expect(across().hasAttribute('data-shown')).toBe(false);
  });

  it('shows across on a sideways scroll alone, the thumb its share and where the scroll is', async () => {
    await scrollAcross(800);
    expect(across().hasAttribute('data-shown')).toBe(true);
    expect(down().hasAttribute('data-shown')).toBe(false);
    // A 384px rail (2px in, the down rail's corner kept), a fifth in view.
    expect(thumb().getBoundingClientRect().width).toBeCloseTo(384 * 0.2, 1);
    expect(offset()).toBeCloseTo((800 / 1600) * (384 - 76.8), 1);
  });

  it('stands on what is stuck over the foot', async () => {
    await scrollAcross(100);
    const box = pane().getBoundingClientRect();
    expect(box.bottom - across().getBoundingClientRect().bottom).toBe(40);
  });

  it('stands on the scroller’s very foot where it says so (`--email-scroll-across-end`)', async () => {
    pane().style.setProperty('--email-scroll-across-end', '0px');
    await scrollAcross(100);
    expect(across().getBoundingClientRect().bottom).toBe(pane().getBoundingClientRect().bottom);
  });

  it('shows while the pointer is over a scroller that runs on sideways', () => {
    pane().dispatchEvent(new PointerEvent('pointerenter'));
    expect(across().hasAttribute('data-shown')).toBe(true);
  });

  it('scrolls sideways as its thumb is dragged', async () => {
    await scrollAcross(0);
    across().setPointerCapture = () => {};
    const x = thumb().getBoundingClientRect().left + 5;
    thumb().dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: x }),
    );
    across().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: x + 153.6 }));
    // Half the thumb's travel is half the scroll range.
    expect(pane().scrollLeft).toBeCloseTo(800, -1);
    across().dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
    expect(across().hasAttribute('data-dragging')).toBe(false);
  });
});

describe('FloatingScrollbar (render)', () => {
  const native = signal(false);
  let fixture: ComponentFixture<Host>;
  let styles: HTMLStyleElement;

  const pane = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.pane')!;
  const bar = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.floating-scrollbar');
  const rail = () => bar()!.querySelector<HTMLElement>('[data-axis="block"]')!;
  const across = () => bar()!.querySelector<HTMLElement>('[data-axis="inline"]')!;
  const thumb = () => rail().querySelector<HTMLElement>('.floating-scrollbar__thumb')!;
  const offset = () => new DOMMatrix(getComputedStyle(thumb()).transform).m42;
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const scrollTo = async (top: number) => {
    pane().scrollTop = top;
    pane().dispatchEvent(new Event('scroll'));
    await frame();
  };

  beforeEach(async () => {
    // The geometry of _floating-scrollbar.scss, without its look.
    styles = document.createElement('style');
    styles.textContent = `
      [data-floating-scrollbar='drawn'] { scrollbar-width: none; }
      .floating-scrollbar { position: absolute; }
      .floating-scrollbar__rail, .floating-scrollbar__thumb { position: absolute; }
      [data-axis='block'].floating-scrollbar__rail { inset-block: calc(var(--_cover-start, 0px) + 2px) calc(var(--_cover-end, 0px) + 2px); inset-inline-end: 0; inline-size: 12px; }
      [data-axis='block'] > .floating-scrollbar__thumb { inset-block-start: 0; inset-inline-end: 2px; inline-size: 6px; }
      [data-axis='inline'].floating-scrollbar__rail { inset-block-end: var(--_cover-end, 0px); inset-inline: 2px 14px; block-size: 12px; }
      [data-axis='inline'] > .floating-scrollbar__thumb { inset-inline-start: 0; inset-block-end: 2px; block-size: 6px; }
    `;
    document.head.appendChild(styles);
    native.set(false);
    TestBed.configureTestingModule({
      providers: [{ provide: Viewport, useValue: { floatingScrollbars: native } }],
    });
    fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    await fixture.whenStable();
    await frame();
  });

  afterEach(() => {
    (fixture.nativeElement as HTMLElement).remove();
    styles.remove();
  });

  it('takes no room: the classic bar is hidden and one is drawn over the scroller', () => {
    expect(pane().getAttribute('data-floating-scrollbar')).toBe('drawn');
    expect(pane().offsetWidth - pane().clientWidth).toBe(0);
    expect(pane().nextElementSibling).toBe(bar());
    expect(bar()!.getAttribute('aria-hidden')).toBe('true');
    expect(rail().hasAttribute('data-shown')).toBe(false);
  });

  it('shows on a scroll, the thumb its share of the rail and where the scroll is', async () => {
    await scrollTo(400);
    expect(rail().hasAttribute('data-shown')).toBe(true);
    // Only the way it scrolled: nothing runs on sideways here.
    expect(across().hasAttribute('data-shown')).toBe(false);
    // Over the scroller exactly.
    expect(bar()!.getBoundingClientRect().toJSON()).toEqual(pane().getBoundingClientRect().toJSON());
    // A 196px rail (2px off each end), a fifth of the text in view.
    expect(thumb().getBoundingClientRect().height).toBeCloseTo(196 * 0.2, 1);
    expect(offset()).toBeCloseTo((400 / 800) * (196 - 39.2), 1);

    await scrollTo(800);
    expect(offset()).toBeCloseTo(196 - 39.2, 1);
  });

  it('keeps the rail clear of what the scroll padding says is stuck over the ends', async () => {
    pane().style.scrollPaddingBlock = '40px 30px';
    await scrollTo(400);
    const rail = thumb().parentElement!.getBoundingClientRect();
    const box = pane().getBoundingClientRect();
    expect(rail.top - box.top).toBe(42);
    expect(box.bottom - rail.bottom).toBe(32);
    // The thumb runs only that rail: at the end, it ends where the rail does.
    await scrollTo(800);
    expect(thumb().getBoundingClientRect().bottom).toBeCloseTo(rail.bottom, 1);
  });

  it('fades a moment after the scroll stops', async () => {
    await scrollTo(100);
    await wait(FLOATING_SCROLLBAR_LINGER / 2);
    expect(rail().hasAttribute('data-shown')).toBe(true);
    await wait(FLOATING_SCROLLBAR_LINGER / 2 + 100);
    expect(rail().hasAttribute('data-shown')).toBe(false);
  });

  it('holds no room once faded — a scroller narrowed since is not widened by it', async () => {
    await scrollTo(100);
    expect(bar()!.getBoundingClientRect().width).toBeGreaterThan(0);
    await wait(FLOATING_SCROLLBAR_LINGER + 300 + 100);
    expect(rail().hasAttribute('data-shown')).toBe(false);
    expect(bar()!.getBoundingClientRect().width).toBe(0);
    expect(bar()!.getBoundingClientRect().height).toBe(0);
    // Shown again: placed over the scroller again.
    await scrollTo(200);
    expect(bar()!.getBoundingClientRect().toJSON()).toEqual(pane().getBoundingClientRect().toJSON());
  });

  it('scrolls the text as its thumb is dragged', async () => {
    await scrollTo(0);
    const rail = thumb().parentElement!;
    rail.setPointerCapture = () => {};
    const down = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      button: 0,
      clientY: 50,
    });
    thumb().dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    rail.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientY: 50 + 78.4 }));
    // Half the thumb's travel is half the scroll range.
    expect(pane().scrollTop).toBeCloseTo(400, -1);
    rail.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
    expect(rail.hasAttribute('data-dragging')).toBe(false);
  });

  it('follows a dragged thumb at once, however smooth the scroller', async () => {
    pane().style.scrollBehavior = 'smooth';
    await scrollTo(0);
    const rail = thumb().parentElement!;
    rail.setPointerCapture = () => {};
    thumb().dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, button: 0, clientY: 50 }),
    );
    rail.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientY: 50 + 78.4 }));
    expect(pane().scrollTop).toBeCloseTo(400, -1);
    rail.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
  });

  it('wears the scroller’s own tokens, not its parent’s', async () => {
    pane().parentElement!.style.setProperty('--email-scroll-thumb', 'red');
    pane().style.setProperty('--email-scroll-thumb', 'rgb(0, 128, 0)');
    pane().style.setProperty('--email-scroll-size', '12px');
    await scrollTo(100);
    expect(getComputedStyle(bar()!).getPropertyValue('--email-scroll-thumb')).toBe('rgb(0, 128, 0)');
    expect(getComputedStyle(bar()!).getPropertyValue('--email-scroll-size')).toBe('12px');
  });

  it('leaves floating platform bars alone, and takes its own away when they start to float', async () => {
    native.set(true);
    await fixture.whenStable();
    await frame();
    expect(pane().getAttribute('data-floating-scrollbar')).toBe('native');
    expect(bar()).toBeNull();
  });
});
