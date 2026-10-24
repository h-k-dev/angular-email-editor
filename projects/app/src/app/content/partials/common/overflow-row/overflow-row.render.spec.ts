/**
 * The row in real Chromium — `npm run test:render` (jsdom has no layout and
 * no ResizeObserver, so the everyday `ng test` skips this file): one line
 * however many items, paddles that follow the items arriving and the scroll,
 * and a mouse drag that scrolls by what the pointer travelled.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { OverflowRow } from './overflow-row';

@Component({
  imports: [OverflowRow],
  template: `<div style="inline-size: 300px">
    <overflow-row [hidden]="!count()">
      @for (n of items(); track n) {
        <button type="button" style="inline-size: 80px; flex: none" (click)="clicks = clicks + 1">
          {{ n }}
        </button>
      }
    </overflow-row>
  </div>`,
})
class Host {
  readonly count = signal(0);
  readonly items = () => Array.from({ length: this.count() }, (_, i) => i + 1);
  clicks = 0;
}

describe('OverflowRow (render)', () => {
  let fixture: ComponentFixture<Host>;

  const root = () => fixture.nativeElement as HTMLElement;
  const scroller = () => root().querySelector<HTMLElement>('.overflow-row__scroll')!;
  const paddles = () => ({
    start: !!root().querySelector('.overflow-row__paddle--start'),
    end: !!root().querySelector('.overflow-row__paddle--end'),
  });
  const frames = async (n = 3) => {
    for (let i = 0; i < n; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    await fixture.whenStable();
  };
  const pointer = (target: Element, type: string, x: number) =>
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: x,
      }),
    );

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    document.body.append(root());
    await fixture.whenStable();
  });

  afterEach(() => root().remove());

  it('keeps one line, and its paddles follow the items arriving and the scroll', async () => {
    // Hidden and empty at first, as the attachment strip starts.
    expect(paddles()).toEqual({ start: false, end: false });

    fixture.componentInstance.count.set(12);
    await frames();
    const buttons = [...root().querySelectorAll('button:not(.overflow-row__paddle-button)')];
    const tops = new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    expect(tops.size).toBe(1);
    expect(paddles()).toEqual({ start: false, end: true });

    // The end paddle pages two thirds of the row along.
    root().querySelector<HTMLElement>('.overflow-row__paddle--end button')!.click();
    await vi.waitFor(() => expect(scroller().scrollLeft).toBeGreaterThan(150));
    await frames();
    expect(paddles()).toEqual({ start: true, end: true });

    scroller().scrollLeft = scroller().scrollWidth;
    await frames();
    expect(paddles()).toEqual({ start: true, end: false });
  });

  it('scrolls by the distance a mouse drag travels, and the click that ends it is swallowed', async () => {
    fixture.componentInstance.count.set(12);
    await frames();
    const el = scroller();
    const item = el.querySelector('button')!;
    const x = item.getBoundingClientRect().left + 40;

    pointer(item, 'pointerdown', x);
    pointer(item, 'pointermove', x - 30);
    pointer(item, 'pointermove', x - 150);
    expect(el.scrollLeft).toBe(150);
    pointer(item, 'pointerup', x - 150);
    item.click();
    expect(fixture.componentInstance.clicks).toBe(0);

    await frames();
    expect(paddles()).toEqual({ start: true, end: true });
  });
});
