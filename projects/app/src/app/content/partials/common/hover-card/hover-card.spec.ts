import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { HoverCard, HoverCards } from './hover-card';

@Component({
  imports: [HoverCard],
  template: `
    <button
      type="button"
      class="one"
      [hoverCard]="card"
      [hoverCardDisabled]="off()"
      hoverCardShowDelay="0"
      hoverCardHideDelay="0"
      #one="hoverCard"
    >
      One
    </button>
    <button type="button" class="two" [hoverCard]="other" [hoverCardShowDelay]="twoDelay">
      Two
    </button>
    <ng-template #card><a class="card-link" href="#">Open</a></ng-template>
    <ng-template #other><p class="other">Other</p></ng-template>
  `,
})
class Host {
  readonly off = signal(false);
  twoDelay = 0;
}

describe('HoverCard', () => {
  const start = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const point = async (element: Element, type: 'pointerenter' | 'pointerleave') => {
      element.dispatchEvent(new Event(type));
      await settle();
    };
    return {
      fixture,
      settle,
      point,
      one: root.querySelector<HTMLElement>('.one')!,
      two: root.querySelector<HTMLElement>('.two')!,
      pane: () => document.querySelector<HTMLElement>('.cdk-overlay-pane.hover-card'),
    };
  };

  afterEach(() => TestBed.inject(HoverCards).close());

  it('shows its template beside the host while the pointer rests on it', async () => {
    const { one, point, pane } = await start();
    expect(pane()).toBeNull();

    await point(one, 'pointerenter');
    expect(pane()?.querySelector('.card-link')?.textContent).toBe('Open');
  });

  it('stays while the pointer is in the card, goes once it has left both', async () => {
    const { one, point, pane } = await start();
    await point(one, 'pointerenter');
    const card = pane()!;

    await point(card, 'pointerenter');
    await point(one, 'pointerleave');
    expect(card.classList).not.toContain('motion-leave');

    await point(card, 'pointerleave');
    expect(card.classList).toContain('motion-leave');
  });

  it('does not come while disabled, and one up goes when it becomes so', async () => {
    const { fixture, one, point, settle, pane } = await start();
    fixture.componentInstance.off.set(true);
    await point(one, 'pointerenter');
    expect(pane()).toBeNull();

    fixture.componentInstance.off.set(false);
    await settle();
    expect(pane()).not.toBeNull();

    fixture.componentInstance.off.set(true);
    await settle();
    expect(pane()?.classList).toContain('motion-leave');
  });

  it('is one at a time: another card takes its place', async () => {
    const { one, two, point } = await start();
    await point(one, 'pointerenter');
    await point(two, 'pointerenter');
    const panes = document.querySelectorAll('.cdk-overlay-pane.hover-card:not(.motion-leave)');
    expect(panes.length).toBe(1);
    expect(panes[0].querySelector('.other')).not.toBeNull();
  });

  it('comes at once right after another: sliding along a row waits once', async () => {
    const { fixture, one, two, point, pane } = await start();
    fixture.componentInstance.twoDelay = 60_000;
    fixture.changeDetectorRef.markForCheck();
    await point(one, 'pointerenter');
    await point(one, 'pointerleave');
    await point(two, 'pointerenter');
    const up = [...document.querySelectorAll('.cdk-overlay-pane.hover-card:not(.motion-leave)')];
    expect(up.map((card) => card.textContent?.trim())).toEqual(['Other']);
    // Taking the last one's place, it has no entrance of its own.
    expect(up[0].classList).not.toContain('motion-enter');
    expect(pane()).not.toBeNull();
  });

  it('does not come for touch — a tap is no hover', async () => {
    const { one, settle, pane } = await start();
    const tap = new Event('pointerenter');
    Object.defineProperty(tap, 'pointerType', { value: 'touch' });
    one.dispatchEvent(tap);
    await settle();
    expect(pane()).toBeNull();
  });
});
