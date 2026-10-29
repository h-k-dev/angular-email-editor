import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SplitHandle } from './split-handle';

@Component({
  imports: [SplitHandle],
  template: `
    <div class="grid" #grid [style.--list.px]="width()">
      <div
        class="handle"
        [(splitHandle)]="width"
        [splitTarget]="grid"
        splitProperty="--list"
        splitMin="200"
        splitMax="500"
        [splitKeep]="keep()"
        [splitEdge]="edge()"
      ></div>
    </div>
  `,
})
class Host {
  readonly width = signal(300);
  readonly keep = signal(0);
  readonly edge = signal<'start' | 'end'>('start');
}

describe('SplitHandle', () => {
  let fixture: ComponentFixture<Host>;
  let handle: HTMLElement;
  let grid: HTMLElement;

  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const pointer = (type: string, clientX: number) =>
    handle.dispatchEvent(
      new PointerEvent(type, { pointerId: 1, button: 0, clientX, bubbles: true, cancelable: true }),
    );
  const key = (key: string, shiftKey = false) =>
    handle.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    handle = fixture.nativeElement.querySelector('.handle');
    grid = fixture.nativeElement.querySelector('.grid');
  });

  it('is a focusable vertical separator whose value is the width', () => {
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.tabIndex).toBe(0);
    expect(handle.getAttribute('aria-valuenow')).toBe('300');
    expect(handle.getAttribute('aria-valuemin')).toBe('200');
    expect(handle.getAttribute('aria-valuemax')).toBe('500');
  });

  it('drags the width straight onto the grid, and commits it only on release', async () => {
    pointer('pointerdown', 100);
    expect(grid.hasAttribute('data-resizing')).toBe(true);
    pointer('pointermove', 150);
    await frame();
    expect(grid.style.getPropertyValue('--list')).toBe('350px');
    // Not through the model while the pointer moves.
    expect(fixture.componentInstance.width()).toBe(300);

    // Held to its range.
    pointer('pointermove', 900);
    await frame();
    expect(grid.style.getPropertyValue('--list')).toBe('500px');

    pointer('pointerup', 900);
    expect(fixture.componentInstance.width()).toBe(500);
    expect(grid.hasAttribute('data-resizing')).toBe(false);
  });

  it('leaves the second column its keep: neither a drag nor End goes past it', async () => {
    Object.defineProperty(grid, 'clientWidth', { configurable: true, value: 700 });
    fixture.componentInstance.keep.set(360);
    await fixture.whenStable();

    pointer('pointerdown', 100);
    pointer('pointermove', 400);
    pointer('pointerup', 400);
    expect(fixture.componentInstance.width()).toBe(340);

    // A width kept from a wider screen moves from where it stands.
    fixture.componentInstance.width.set(480);
    await fixture.whenStable();
    key('ArrowLeft');
    expect(fixture.componentInstance.width()).toBe(324);
    key('End');
    expect(fixture.componentInstance.width()).toBe(340);
  });

  it('steps with the arrows (Shift: four steps), and goes to its ends with Home and End', async () => {
    key('ArrowRight');
    expect(fixture.componentInstance.width()).toBe(316);
    key('ArrowLeft', true);
    expect(fixture.componentInstance.width()).toBe(252);
    key('Home');
    expect(fixture.componentInstance.width()).toBe(200);
    key('ArrowLeft');
    expect(fixture.componentInstance.width()).toBe(200);
    key('End');
    expect(fixture.componentInstance.width()).toBe(500);
    await fixture.whenStable();
    expect(handle.getAttribute('aria-valuenow')).toBe('500');
  });

  it('sizes an end column the other way: left widens it, by pointer and by key', async () => {
    fixture.componentInstance.edge.set('end');
    await fixture.whenStable();

    pointer('pointerdown', 400);
    pointer('pointermove', 350);
    await frame();
    expect(grid.style.getPropertyValue('--list')).toBe('350px');
    pointer('pointerup', 350);
    expect(fixture.componentInstance.width()).toBe(350);

    key('ArrowLeft');
    expect(fixture.componentInstance.width()).toBe(366);
    key('ArrowRight', true);
    expect(fixture.componentInstance.width()).toBe(302);
    // Its ends are its least and most, whichever side it stands on.
    key('Home');
    expect(fixture.componentInstance.width()).toBe(200);
    key('End');
    expect(fixture.componentInstance.width()).toBe(500);
  });
});
