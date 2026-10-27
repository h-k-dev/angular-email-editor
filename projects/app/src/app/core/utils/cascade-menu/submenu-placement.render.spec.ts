/**
 * A cascading list's place in real Chromium — `npm run test:render` (jsdom
 * has no layout): an Angular Aria menu wearing `submenuPlacement` opens its
 * list beside its row, on the side with room, pushed into the screen.
 */
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

// Angular Aria
import { Menu, MenuItem } from '@angular/aria/menu';

import { MenuSafeTriangle } from './safe-triangle';
import { SubmenuPlacement } from './submenu-placement';

@Component({
  imports: [Menu, MenuItem, MenuSafeTriangle, SubmenuPlacement],
  styles: `
    .menu {
      position: fixed;
      inline-size: 150px;
      padding: 4px;
      box-sizing: border-box;
      background: white;
    }
    .row {
      block-size: 32px;
    }
    .heading {
      block-size: 24px;
    }
    .list {
      position: absolute;
      inline-size: 150px;
      block-size: 200px;
      padding: 4px;
      box-sizing: border-box;
      background: white;
    }
    .list[data-visible='false'] {
      display: none;
    }
  `,
  template: `<div
    ngMenu
    menuSafeTriangle
    class="menu"
    aria-label="Menu"
    [style.left.px]="x()"
    [style.top.px]="y()"
  >
    <div ngMenuItem class="row" value="other">Other</div>
    <div ngMenuItem class="row opener" value="color" [submenu]="list">Color</div>
    <div
      ngMenu
      #list="ngMenu"
      class="list"
      aria-label="List"
      submenuPlacement
      [submenuPlacementAvoid]="avoid()"
    >
      @if (heading()) {
        <div class="heading">Background</div>
      }
      <div ngMenuItem class="row" value="red">Red</div>
    </div>
  </div>`,
})
class Host {
  readonly x = signal(20);
  readonly y = signal(20);
  readonly avoid = signal<DOMRect | null>(null);
  readonly heading = signal(false);
}

describe('SubmenuPlacement (render)', () => {
  let fixture: ComponentFixture<Host>;

  const el = (selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector)!;
  const box = (selector: string) => el(selector).getBoundingClientRect();
  const viewport = () => ({
    width: document.documentElement.clientWidth,
    height: document.documentElement.clientHeight,
  });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /** The menu at (x, y); the list opened from its row by the pointer. */
  async function open(x: number, y: number, avoid: DOMRect | null = null): Promise<void> {
    fixture.componentInstance.x.set(x);
    fixture.componentInstance.y.set(y);
    fixture.componentInstance.avoid.set(avoid);
    await fixture.whenStable();
    const row = box('.opener');
    el('.opener').dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true, clientX: row.left + 5, clientY: row.top + 5 }),
    );
    await wait(200); // Aria's expansion delay
    await fixture.whenStable();
    expect(el('.list').dataset['visible']).toBe('true');
  }

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    document.body.append(fixture.nativeElement);
    await fixture.whenStable();
  });

  afterEach(() => (fixture.nativeElement as HTMLElement).remove());

  it('stands to the right, over the edge, its first row level with its row', async () => {
    await open(20, 20);
    expect(el('.list').dataset['side']).toBe('right');
    expect(box('.list').left).toBeCloseTo(box('.menu').right - 6, 0);
    expect(box('.list .row').top).toBeCloseTo(box('.opener').top, 0);
  });

  it('levels its first row, not its heading, with its row — the heading rises above', async () => {
    fixture.componentInstance.heading.set(true);
    await open(20, 100);
    expect(box('.list .row').top).toBeCloseTo(box('.opener').top, 0);
    expect(box('.list .heading').bottom).toBeCloseTo(box('.opener').top, 0);
  });

  it('goes left where the right has no room', async () => {
    await open(viewport().width - 160, 20);
    expect(el('.list').dataset['side']).toBe('left');
    expect(box('.list').right).toBeCloseTo(box('.menu').left + 6, 0);
    expect(box('.list').left).toBeGreaterThanOrEqual(8);
  });

  it('goes left, away from what the menu is about', async () => {
    await open(200, 20, new DOMRect(360, 30, 16, 16));
    expect(el('.list').dataset['side']).toBe('left');
  });

  it('is pushed up where it would run past the bottom', async () => {
    await open(20, viewport().height - 90);
    const list = box('.list');
    expect(list.bottom).toBeCloseTo(viewport().height - 8, 0);
    expect(list.top).toBeLessThan(box('.opener').top);
  });
});
