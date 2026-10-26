/**
 * The grid in real Chromium — `npm run test:render` (jsdom has no layout and
 * no ResizeObserver): 1000px wide in a 600px owner of the scroll, cards
 * 160px tall under a 40px row gap — a 200px row, three columns of at least
 * 280px.
 */
import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ScrollOwner } from '../../../../core/directives/scroll-owner/scroll-owner';
import { VirtualGrid, VirtualGridItem, VirtualGridPlaceholder } from './virtual-grid';

interface Item {
  readonly id: number;
}

const itemsUpTo = (count: number): Item[] => Array.from({ length: count }, (_, id) => ({ id }));

@Component({
  imports: [VirtualGrid, VirtualGridItem, ScrollOwner],
  template: `
    <div class="scroller" style="block-size: 600px; inline-size: 1000px; overflow-y: auto">
      <main [scrollOwner]="owns()" style="block-size: 600px">
        <virtual-grid
          [min]="280"
          [gap]="16"
          [rowGap]="40"
          [estimate]="100"
          [maxColumns]="maxColumns()"
          [max]="max()"
          [total]="total()"
          [tint]="tint()"
          (endReached)="ends.set(ends() + 1)"
        >
          <div class="card" style="block-size: 160px" *virtualGridItem="let item of items(); let index = index">
            {{ item.id }}:{{ index }}
          </div>
        </virtual-grid>
      </main>
    </div>
  `,
})
class Host {
  readonly owns = signal(true);
  readonly items = signal<readonly Item[]>(itemsUpTo(100));
  readonly maxColumns = signal(5);
  readonly max = signal<number | null>(null);
  readonly total = signal<number | undefined>(undefined);
  readonly tint = signal<((item: Item) => string | null) | null>(null);
  readonly ends = signal(0);
  readonly grid = viewChild.required<VirtualGrid<Item>>(VirtualGrid);
}

@Component({
  imports: [VirtualGrid, VirtualGridItem, VirtualGridPlaceholder],
  template: `
    <main style="block-size: 600px; inline-size: 1000px; overflow-y: auto">
      <virtual-grid [rowGap]="40" [total]="9">
        <div class="card" style="block-size: 160px" *virtualGridItem="let item of items">{{ item.id }}</div>
        <ng-template virtualGridPlaceholder><div class="ghost" style="block-size: 160px"></div></ng-template>
      </virtual-grid>
    </main>
  `,
})
class PlaceholderHost {
  readonly items = itemsUpTo(2);
}

describe('VirtualGrid (render)', () => {
  let fixture: ComponentFixture<Host>;

  const host = () => fixture.componentInstance;
  const root = () => fixture.nativeElement as HTMLElement;
  const grid = () => root().querySelector<HTMLElement>('virtual-grid')!;
  const cells = () => [...root().querySelectorAll<HTMLElement>('.virtual-grid__cell')];
  const items = () => [...root().querySelectorAll<HTMLElement>('.virtual-grid__item')];
  const owner = () => root().querySelector<HTMLElement>('main')!;
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  /** Measured, ranged, drawn — a few frames settle it. */
  const settle = async () => {
    for (let round = 0; round < 4; round++) {
      await fixture.whenStable();
      await frame();
    }
  };

  const scroll = async (scroller: HTMLElement, top: number) => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event('scroll'));
    await settle();
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    await settle();
  });

  afterEach(() => root().remove());

  it('folds the width into columns of at least `min`, `maxColumns` at the most', async () => {
    expect(grid().style.getPropertyValue('--grid-columns')).toBe('3');

    host().maxColumns.set(2);
    await settle();
    expect(grid().style.getPropertyValue('--grid-columns')).toBe('2');
  });

  it('caps a column at `max`, the row centred under it', async () => {
    host().max.set(200);
    await settle();
    const [first] = items();
    expect(Math.round(first.getBoundingClientRect().width)).toBe(200);
    const left = first.getBoundingClientRect().left - grid().getBoundingClientRect().left;
    expect(Math.round(left)).toBe((1000 - (3 * 200 + 2 * 16)) / 2);
  });

  it('draws only the rows in view and their overscan, each item a listitem with its place', () => {
    // 600px over a 200px row is 3 rows, and 2 overscan below: 5 rows of 3.
    expect(cells().length).toBe(15);
    expect(grid().getAttribute('role')).toBe('list');
    expect(items()[0].getAttribute('role')).toBe('listitem');
    expect(items()[0].getAttribute('aria-posinset')).toBe('1');
    expect(items()[0].getAttribute('aria-setsize')).toBe('100');
    expect(items()[0].textContent!.trim()).toBe('0:0');
    // 34 rows, the last without the gap under it.
    expect(grid().style.blockSize).toBe(`${34 * 200 - 40}px`);
  });

  it('follows its owner’s scroll, the rows drawn moved down into place', async () => {
    await scroll(owner(), 2000);
    // Row 10 at the top, 2 overscan above: from row 8, the 25th item.
    expect(items()[0].getAttribute('aria-posinset')).toBe('25');
    expect(Math.round(items()[0].getBoundingClientRect().top - grid().getBoundingClientRect().top)).toBe(1600);
  });

  it('scrolls with the nearest scroller when no owner takes the scroll', async () => {
    host().owns.set(false);
    await settle();
    await scroll(root().querySelector<HTMLElement>('.scroller')!, 2000);
    expect(items()[0].getAttribute('aria-posinset')).toBe('25');
  });

  it('draws the places past the items as placeholders up to `total`, and says how many it wants', async () => {
    host().items.set(itemsUpTo(4));
    host().total.set(50);
    await settle();
    expect(items().length).toBe(4);
    const placeholders = root().querySelectorAll('.virtual-grid__placeholder');
    expect(placeholders.length).toBe(11);
    expect(placeholders[0].getAttribute('aria-hidden')).toBe('true');
    expect(host().grid().demand()).toBe(15);
    expect(items()[0].getAttribute('aria-setsize')).toBe('50');
  });

  it('asks for more as the end comes near, until every place has come', async () => {
    host().items.set([]);
    await settle();
    expect(host().ends()).toBeGreaterThan(0);

    host().items.set(itemsUpTo(100));
    await settle();
    host().ends.set(0);
    await scroll(owner(), 3000);
    expect(host().ends()).toBe(0);

    await scroll(owner(), 34 * 200 - 600);
    expect(host().ends()).toBeGreaterThan(0);

    host().total.set(100);
    host().ends.set(0);
    await scroll(owner(), 34 * 200 - 700);
    expect(host().ends()).toBe(0);
  });

  it('washes an item in its own colour', async () => {
    host().tint.set((item) => (item.id === 0 ? 'rgb(255, 0, 0)' : null));
    await settle();
    const [first, second] = items();
    expect(first.classList).toContain('virtual-grid__item--tinted');
    expect(first.style.getPropertyValue('--virtual-grid-tint')).toBe('rgb(255, 0, 0)');
    expect(second.classList).not.toContain('virtual-grid__item--tinted');
  });

  it('brings the first row back to the top of the view', async () => {
    await scroll(owner(), 2000);
    host().grid().scrollToStart();
    expect(owner().scrollTop).toBe(0);
  });

  it('draws a placeholder of the cards’ own shape where one is given', async () => {
    const other = TestBed.createComponent(PlaceholderHost);
    document.body.append(other.nativeElement);
    for (let round = 0; round < 4; round++) {
      await other.whenStable();
      await frame();
    }
    const element = other.nativeElement as HTMLElement;
    expect(element.querySelectorAll('.virtual-grid__placeholder .ghost').length).toBe(7);
    expect(element.querySelector('.virtual-grid__bone')).toBeNull();
    element.remove();
  });
});
