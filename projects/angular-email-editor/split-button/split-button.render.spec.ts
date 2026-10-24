/**
 * The morph's geometry — `npm run test:render`, in real Chromium (jsdom has
 * no layout, so the everyday `ng test` skips this file). The trailing half
 * opens on a grid track run from 0fr to 1fr: closed it must take no room
 * at all, open exactly its icon box, and the leading half must be the
 * icon button it was before the split.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { userEvent } from 'vitest/browser';
import { SplitButton } from './split-button';
import { SplitButtonLeading, SplitButtonTrailing } from './split-button-item';

@Component({
  imports: [SplitButton, SplitButtonLeading, SplitButtonTrailing],
  template: `<hk-split-button aria-label="Attachments" [split]="split()">
    <button hkSplitButtonLeading aria-label="Attach">📎</button>
    <button hkSplitButtonTrailing aria-label="Show"></button>
  </hk-split-button>`,
})
class Host {
  readonly split = signal(false);
}

describe('SplitButton (render)', () => {
  let fixture: ComponentFixture<Host>;

  const root = () => fixture.nativeElement as HTMLElement;
  const group = () => root().querySelector<HTMLElement>('hk-split-button')!;
  const leading = () => root().querySelector<HTMLElement>('[hkSplitButtonLeading]')!;
  const trailing = () => root().querySelector<HTMLElement>('[hkSplitButtonTrailing]')!;
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  /** Settled, with every transition skipped to its end. */
  const settle = async () => {
    await fixture.whenStable();
    await frame();
    for (const element of [group(), leading(), trailing()]) {
      element.getAnimations().forEach((animation) => animation.finish());
    }
  };
  const width = (element: HTMLElement) => Math.round(element.getBoundingClientRect().width);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    // Room round it: the touch target reaches past the button, and a point
    // off the page hits nothing.
    root().style.padding = '24px';
    document.body.appendChild(root());
    await settle();
  });

  afterEach(() => root().remove());

  it('alone is a 40px circle and nothing else', () => {
    expect(width(leading())).toBe(40);
    expect(Math.round(leading().getBoundingClientRect().height)).toBe(40);
    expect(getComputedStyle(leading()).borderTopRightRadius).not.toBe('4px');
    expect(width(trailing())).toBe(0);
    expect(width(group())).toBe(40);
  });

  it('split, opens a smaller trailing half beside the square leading one', async () => {
    fixture.componentInstance.split.set(true);
    await settle();

    expect(width(leading())).toBe(40);
    expect(Math.round(leading().getBoundingClientRect().height)).toBe(40);
    expect(width(trailing())).toBe(40 - 8 - 2);
    // Two icon buttons less 8px.
    expect(width(group())).toBe(72);
    expect(getComputedStyle(leading()).borderTopRightRadius).toBe('4px');
    expect(getComputedStyle(trailing()).borderTopLeftRadius).toBe('4px');
  });

  it('split, is still an icon button at rest: no surface on either half, unless asked', async () => {
    fixture.componentInstance.split.set(true);
    await settle();
    const transparent = 'rgba(0, 0, 0, 0)';

    expect(getComputedStyle(leading()).backgroundColor).toBe(transparent);
    expect(getComputedStyle(trailing()).backgroundColor).toBe(transparent);

    group().style.setProperty('--hk-split-button-container-color', 'rgb(1, 2, 3)');
    await settle();
    expect(getComputedStyle(leading()).backgroundColor).toBe('rgb(1, 2, 3)');
  });

  it('parts the halves by half a system spacing unit', async () => {
    fixture.componentInstance.split.set(true);
    await settle();
    const gap = () => trailing().getBoundingClientRect().left - leading().getBoundingClientRect().right;
    // 0.25rem / 2 at the 16px root.
    expect(gap()).toBe(2);

    group().style.setProperty('--mat-sys-spacing', '8px');
    await settle();
    expect(gap()).toBe(4);
  });

  it('sizes from the icon button’s tokens, and ours over them', async () => {
    group().style.setProperty('--mat-icon-button-state-layer-size', '48px');
    await settle();
    expect(width(leading())).toBe(48);
    expect(Math.round(leading().getBoundingClientRect().height)).toBe(48);

    group().style.setProperty('--hk-split-button-state-layer-size', '36px');
    await settle();
    expect(width(leading())).toBe(36);
  });

  it('takes a press in its touch target, past the state layer, as the icon button does', () => {
    const box = leading().getBoundingClientRect();
    const middle = box.left + box.width / 2;
    // The 48px target reaches 4px past the 40px state layer.
    expect(document.elementFromPoint(middle, box.top - 3)).toBe(leading());
    expect(document.elementFromPoint(box.left - 3, box.top + 20)).toBe(leading());
    expect(document.elementFromPoint(middle, box.top - 6)).not.toBe(leading());
  });

  it('shares the gap between the halves’ touch targets, never overlapping', async () => {
    fixture.componentInstance.split.set(true);
    await settle();
    const lead = leading().getBoundingClientRect();
    const trail = trailing().getBoundingClientRect();
    const y = lead.top + lead.height / 2;

    expect(trail.left - lead.right).toBe(2);
    // Each half owns one pixel of the gap — whole pixels: a fractional point
    // is rounded by the hit test.
    expect(document.elementFromPoint(lead.right, y)).toBe(leading());
    expect(document.elementFromPoint(trail.left - 1, y)).toBe(trailing());
    // Above the trailing half, its own target, not the leading one's.
    expect(document.elementFromPoint(trail.left + trail.width / 2, trail.top - 3)).toBe(trailing());
  });

  it('lights both halves while the pointer is anywhere in either touch target', async () => {
    fixture.componentInstance.split.set(true);
    await settle();
    /** A state layer's opacity, its fade skipped to the end. */
    const layer = (half: HTMLElement) => {
      half.getAnimations({ subtree: true }).forEach((animation) => animation.finish());
      return Number(getComputedStyle(half, '::before').opacity);
    };
    expect([layer(leading()), layer(trailing())]).toEqual([0, 0]);

    // Over the trailing half's touch target, 3px above its state layer: a
    // real pointer, so the browser's own :hover.
    const box = trailing().getBoundingClientRect();
    await userEvent.hover(trailing(), { position: { x: box.width / 2, y: -3 } });
    await frame();
    expect(trailing().matches(':hover')).toBe(true);
    expect([layer(leading()), layer(trailing())]).toEqual([0.08, 0.08]);

    // Over the leading half itself — still both.
    await userEvent.hover(leading());
    await frame();
    expect([layer(leading()), layer(trailing())]).toEqual([0.08, 0.08]);

    // Away: both dark again.
    await userEvent.unhover(leading());
    await frame();
    expect([layer(leading()), layer(trailing())]).toEqual([0, 0]);
  });

  it('drops the touch target where the icon button would (touch-target-display)', async () => {
    group().style.setProperty('--mat-icon-button-touch-target-display', 'none');
    await settle();
    const box = leading().getBoundingClientRect();

    expect(document.elementFromPoint(box.left + box.width / 2, box.top - 3)).not.toBe(leading());
  });

  it('closes back to the circle', async () => {
    fixture.componentInstance.split.set(true);
    await settle();
    fixture.componentInstance.split.set(false);
    await settle();

    expect(width(trailing())).toBe(0);
    expect(width(group())).toBe(40);
  });
});
