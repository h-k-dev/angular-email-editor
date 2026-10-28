/**
 * The floating scrollbar in real Chromium — `npm run test:render` (jsdom has
 * no layout): where the platform's bars float it stays out of the way; where
 * they are classic it hides the platform's and draws a thumb over the
 * scroller that shows on a scroll, follows it, drags, and fades.
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

describe('FloatingScrollbar (render)', () => {
  const native = signal(false);
  let fixture: ComponentFixture<Host>;
  let styles: HTMLStyleElement;

  const pane = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.pane')!;
  const bar = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.floating-scrollbar');
  const thumb = () => bar()!.querySelector<HTMLElement>('.floating-scrollbar__thumb')!;
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
      .floating-scrollbar__rail { position: absolute; inset-block: calc(var(--_cover-start, 0px) + 2px) calc(var(--_cover-end, 0px) + 2px); inset-inline-end: 0; inline-size: 12px; }
      .floating-scrollbar__thumb { position: absolute; inset-block-start: 0; inset-inline-end: 2px; inline-size: 6px; }
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
    expect(bar()!.hasAttribute('data-shown')).toBe(false);
  });

  it('shows on a scroll, the thumb its share of the rail and where the scroll is', async () => {
    await scrollTo(400);
    expect(bar()!.hasAttribute('data-shown')).toBe(true);
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
    expect(bar()!.hasAttribute('data-shown')).toBe(true);
    await wait(FLOATING_SCROLLBAR_LINGER / 2 + 100);
    expect(bar()!.hasAttribute('data-shown')).toBe(false);
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
    expect(bar()!.hasAttribute('data-dragging')).toBe(false);
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
