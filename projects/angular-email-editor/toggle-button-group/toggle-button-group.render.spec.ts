/**
 * The thumb's place — `npm run test:render`, in real Chromium (jsdom has no
 * layout and no ResizeObserver, so the everyday `ng test` skips this file).
 * Items differ in size, a circle and a pill, so the thumb is read from the
 * picked item's box: it must cover exactly that box, follow a pick, and
 * follow the item when its words change length.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ToggleButtonGroup } from './toggle-button-group';
import { ToggleButtonGroupIcon, ToggleButtonGroupText } from './toggle-button-group-item';

@Component({
  imports: [ToggleButtonGroup, ToggleButtonGroupIcon, ToggleButtonGroupText],
  template: `<hk-tgb aria-label="Appearance" [(value)]="scheme">
    <button hkTgbIcon value="light" aria-label="Light">
      <svg width="1em" height="1em" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /></svg>
    </button>
    <button hkTgbIcon value="dark" aria-label="Dark"><i></i></button>
    <button hkTgbText value="auto">{{ auto() }}</button>
  </hk-tgb>`,
})
class Host {
  readonly scheme = signal<'light' | 'dark' | 'auto'>('auto');
  readonly auto = signal('Auto');
}

describe('ToggleButtonGroup (render)', () => {
  let fixture: ComponentFixture<Host>;

  const root = () => fixture.nativeElement as HTMLElement;
  const group = () => root().querySelector<HTMLElement>('hk-tgb')!;
  const thumb = () => group().querySelector<HTMLElement>('[data-slot=thumb]')!;
  const items = () => [...group().querySelectorAll<HTMLElement>('[role=radio]')];
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  /** The thumb's box with its motion skipped to the end. */
  const thumbRect = () => {
    thumb()
      .getAnimations()
      .forEach((animation) => animation.finish());
    return thumb().getBoundingClientRect();
  };
  const settle = async () => {
    await fixture.whenStable();
    await frame();
    await frame();
  };
  const expectOver = (item: HTMLElement) => {
    const a = thumbRect();
    const b = item.getBoundingClientRect();
    expect(Math.round(a.left)).toBe(Math.round(b.left));
    expect(Math.round(a.top)).toBe(Math.round(b.top));
    expect(Math.round(a.width)).toBe(Math.round(b.width));
    expect(Math.round(a.height)).toBe(Math.round(b.height));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    document.body.appendChild(root());
    await settle();
  });

  afterEach(() => {
    fixture.destroy();
    root().remove();
  });

  it('makes icons circles and words a pill', () => {
    const [light, dark, auto] = items().map((item) => item.getBoundingClientRect());
    expect(light.width).toBe(light.height);
    expect(dark.width).toBe(dark.height);
    expect(auto.width).toBeGreaterThan(auto.height);
    // The icon inside fits the item's icon box.
    expect(items()[0].querySelector('svg')!.getBoundingClientRect().width).toBe(18);
  });

  it('finds the picked item when shown out of display: none, with no render after', async () => {
    // Rendered while out of sight (a closed dialog, a hidden tab page)…
    root().style.display = 'none';
    fixture.detectChanges();
    await frame();
    // …then shown by CSS alone: no change detection follows.
    root().style.display = '';
    await frame();
    await frame();
    expectOver(items()[2]);
  });

  it('covers the picked item, and follows a pick from pill to circle', async () => {
    expectOver(items()[2]);
    items()[0].click();
    await settle();
    expectOver(items()[0]);
    expect(group().hasAttribute('data-placed')).toBe(true);
  });

  it('follows the picked item when its words change length', async () => {
    fixture.componentInstance.auto.set('Automatisch');
    await settle();
    await settle();
    expectOver(items()[2]);
  });
});
