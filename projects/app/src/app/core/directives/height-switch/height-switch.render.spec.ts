/**
 * The switch's motion in real Chromium — `npm run test:render` (jsdom has no
 * layout and no ResizeObserver): a switch runs the box's height from the old
 * look's to the new one's, then lets go; anything else follows at once.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { HEIGHT_SWITCH, HeightSwitch } from './height-switch';

@Component({
  imports: [HeightSwitch],
  template: `<div class="box" style="box-sizing: border-box; padding: 5px" [heightSwitch]="rows()">
    <div [style.height.px]="rows() === 'two' ? 90 : extra() ? 60 : 40"></div>
  </div>`,
})
class Host {
  readonly rows = signal<'one' | 'two'>('one');
  readonly extra = signal(false);
}

describe('HeightSwitch (render)', () => {
  let fixture: ComponentFixture<Host>;

  const box = () => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.box')!;
  const height = () => Math.round(box().getBoundingClientRect().height);
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    await fixture.whenStable();
    await frame();
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('runs the height across a switch, then lets go', async () => {
    expect(height()).toBe(50);

    fixture.componentInstance.rows.set('two');
    await fixture.whenStable();
    await frame();
    await frame();
    expect(box().hasAttribute('data-height-switch')).toBe(true);
    const midway = height();
    expect(midway).toBeGreaterThanOrEqual(50);
    expect(midway).toBeLessThan(100);

    await wait(HEIGHT_SWITCH + 100);
    expect(box().hasAttribute('data-height-switch')).toBe(false);
    expect(box().style.height).toBe('');
    expect(height()).toBe(100);
  });

  it('follows a change that is no switch at once', async () => {
    fixture.componentInstance.extra.set(true);
    await fixture.whenStable();
    await frame();
    await frame();
    expect(box().hasAttribute('data-height-switch')).toBe(false);
    expect(height()).toBe(70);
  });
});
