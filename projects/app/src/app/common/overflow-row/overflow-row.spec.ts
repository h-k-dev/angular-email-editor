import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OverflowRow, OverflowRowRole } from './overflow-row';

@Component({
  imports: [OverflowRow],
  template: `
    <overflow-row [rowRole]="rowRole" [rowLabel]="rowLabel" [dragScroll]="dragScroll()">
      <button type="button" (click)="clicks = clicks + 1">One</button>
      <button type="button">Two</button>
    </overflow-row>
  `,
})
class Host {
  rowRole: OverflowRowRole | null = 'group';
  rowLabel = 'Shortcuts';
  readonly dragScroll = signal(true);
  clicks = 0;
}

describe('OverflowRow', () => {
  let fixture: ComponentFixture<Host>;

  const root = (): HTMLElement => fixture.nativeElement;
  const host = (): HTMLElement => root().querySelector('overflow-row')!;
  const row = (): HTMLElement => root().querySelector('.overflow-row__row')!;
  const scroller = (): HTMLElement => root().querySelector('.overflow-row__scroll')!;
  const startPaddle = (): HTMLElement | null => root().querySelector('.overflow-row__paddle--start');
  const endPaddle = (): HTMLElement | null => root().querySelector('.overflow-row__paddle--end');

  /** jsdom lays nothing out, so the scroll geometry is stubbed — the
      scroll position writable, as a drag writes it. */
  const measure = (scrolled: number, scrollWidth: number, clientWidth: number): HTMLElement => {
    const el = scroller();
    let left = scrolled;
    Object.defineProperty(el, 'scrollLeft', {
      configurable: true,
      get: () => left,
      set: (value: number) => (left = Math.max(0, Math.min(value, scrollWidth - clientWidth))),
    });
    Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => scrollWidth });
    Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => clientWidth });
    // jsdom has no pointer capture.
    let captured: number | null = null;
    el.setPointerCapture = (id: number) => void (captured = id);
    el.releasePointerCapture = () => void (captured = null);
    el.hasPointerCapture = (id: number) => captured === id;

    el.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();

    return el;
  };

  /** A mouse pointer event on `target` at `x`. */
  const pointer = (
    target: Element,
    type: string,
    x: number,
    init: Partial<PointerEventInit> = {},
  ): PointerEvent => {
    const event = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: x,
      ...init,
    });
    target.dispatchEvent(event);
    return event;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();

    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('projects items into a labelled row', () => {
    expect(row().getAttribute('role')).toBe('group');
    expect(row().getAttribute('aria-label')).toBe('Shortcuts');
    expect(row().querySelectorAll('button').length).toBe(2);
  });

  it('shows no paddle while nothing overflows', () => {
    measure(0, 200, 200);

    expect(startPaddle()).toBeNull();
    expect(endPaddle()).toBeNull();
  });

  it('shows a start paddle only once content hides behind that edge', () => {
    measure(0, 400, 200);
    expect(startPaddle()).toBeNull();
    expect(endPaddle()).toBeTruthy();

    measure(40, 400, 200);
    expect(startPaddle()).toBeTruthy();
    expect(endPaddle()).toBeTruthy();
  });

  it('retires the end paddle at the end of the scroll', () => {
    measure(200, 400, 200);

    expect(startPaddle()).toBeTruthy();
    expect(endPaddle()).toBeNull();
  });

  it('pages by two thirds of the viewport', () => {
    const el = measure(80, 400, 300);
    const scrollBy = vi.fn();
    el.scrollBy = scrollBy;

    startPaddle()!.querySelector('button')!.click();

    expect(scrollBy).toHaveBeenCalledWith({ left: -300 * 0.66, behavior: expect.any(String) });
  });

  it('keeps a paddle click from parking focus in the aria-hidden subtree', () => {
    measure(40, 400, 200);

    const paddle = startPaddle()!;
    expect(paddle.getAttribute('aria-hidden')).toBe('true');

    const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    paddle.querySelector('button')!.dispatchEvent(mousedown);

    expect(mousedown.defaultPrevented).toBe(true);
  });

  describe('drag to scroll', () => {
    it('scrolls with a mouse drag, holding the pointer, and lets go', () => {
      const el = measure(100, 600, 200);
      const item = row().querySelector('button')!;

      pointer(item, 'pointerdown', 300);
      pointer(item, 'pointermove', 298);
      // Within the slop: still a click in the making.
      expect(el.scrollLeft).toBe(100);
      expect(el.hasPointerCapture(1)).toBe(false);

      pointer(item, 'pointermove', 240);
      fixture.detectChanges();
      expect(el.scrollLeft).toBe(160);
      expect(el.hasPointerCapture(1)).toBe(true);
      expect(host().hasAttribute('data-dragging')).toBe(true);

      pointer(el, 'pointermove', 380);
      expect(el.scrollLeft).toBe(20);

      pointer(el, 'pointerup', 380);
      fixture.detectChanges();
      expect(el.hasPointerCapture(1)).toBe(false);
      expect(host().hasAttribute('data-dragging')).toBe(false);
    });

    it('swallows the click that ends a drag, and only that one', async () => {
      const el = measure(0, 600, 200);
      const item = row().querySelector('button')!;

      pointer(item, 'pointerdown', 300);
      pointer(item, 'pointermove', 200);
      pointer(item, 'pointerup', 200);
      item.click();
      expect(fixture.componentInstance.clicks).toBe(0);
      expect(el.scrollLeft).toBe(100);

      // A press that does not travel is a click.
      pointer(item, 'pointerdown', 200);
      pointer(item, 'pointerup', 201);
      item.click();
      expect(fixture.componentInstance.clicks).toBe(1);

      // A drag whose click never comes swallows no later one (a key's).
      pointer(item, 'pointerdown', 300);
      pointer(item, 'pointermove', 250);
      pointer(item, 'pointerup', 250);
      await new Promise((resolve) => setTimeout(resolve));
      item.click();
      expect(fixture.componentInstance.clicks).toBe(2);
    });

    it('keeps a selection or a native drag from starting off a press', () => {
      measure(0, 600, 200);
      const item = row().querySelector('button')!;
      pointer(item, 'pointerdown', 300);
      const select = new Event('selectstart', { bubbles: true, cancelable: true });
      item.dispatchEvent(select);
      const drag = new Event('dragstart', { bubbles: true, cancelable: true });
      item.dispatchEvent(drag);
      expect(select.defaultPrevented).toBe(true);
      expect(drag.defaultPrevented).toBe(true);
    });

    it('leaves touch, pen, other buttons and a row that fits alone', () => {
      const el = measure(0, 600, 200);
      const item = row().querySelector('button')!;
      for (const init of [{ pointerType: 'touch' }, { pointerType: 'pen' }, { button: 1 }]) {
        pointer(item, 'pointerdown', 300, init);
        pointer(item, 'pointermove', 200, init);
        pointer(item, 'pointerup', 200, init);
      }
      expect(el.scrollLeft).toBe(0);

      const fits = measure(0, 200, 200);
      pointer(item, 'pointerdown', 300);
      pointer(item, 'pointermove', 200);
      fixture.detectChanges();
      expect(host().hasAttribute('data-dragging')).toBe(false);
      expect(fits.scrollLeft).toBe(0);
    });

    it('can be turned off', () => {
      fixture.componentInstance.dragScroll.set(false);
      fixture.detectChanges();
      const el = measure(100, 600, 200);
      const item = row().querySelector('button')!;

      pointer(item, 'pointerdown', 300);
      const move = pointer(item, 'pointermove', 200);
      pointer(item, 'pointerup', 200);
      item.click();

      expect(el.scrollLeft).toBe(100);
      expect(move.defaultPrevented).toBe(false);
      expect(fixture.componentInstance.clicks).toBe(1);
    });
  });
});
