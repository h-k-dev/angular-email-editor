import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MenuSafeTriangle, aimsAt } from './safe-triangle';

/** A list to the right of the menu: x 200–400, y 0–300. */
const LIST = new DOMRect(200, 0, 200, 300);

describe('aimsAt', () => {
  it('holds a diagonal towards the list', () => {
    expect(aimsAt({ x: 100, y: 20 }, { x: 110, y: 30 }, LIST, 0)).toBe(true);
  });

  it('lets a pointer turning away, or straight down, go', () => {
    expect(aimsAt({ x: 100, y: 20 }, { x: 90, y: 30 }, LIST, 0)).toBe(false);
    expect(aimsAt({ x: 100, y: 20 }, { x: 100, y: 30 }, LIST, 0)).toBe(false);
  });

  it('aims up at a list over its trigger on the block axis — a toolbar’s second row', () => {
    // A row above: x 100–300, y 0–40; the pointer leaves its ⋮ at (290, 80).
    const row = new DOMRect(100, 0, 200, 40);
    const from = { x: 290, y: 80 };
    // Up and to the left, towards the row's far end: held.
    expect(aimsAt(from, { x: 270, y: 70 }, row, 0, 'block')).toBe(true);
    // Along the main row, or down: let go.
    expect(aimsAt(from, { x: 260, y: 80 }, row, 0, 'block')).toBe(false);
    expect(aimsAt(from, { x: 280, y: 90 }, row, 0, 'block')).toBe(false);
  });

  it('heads nowhere without moving', () => {
    expect(aimsAt({ x: 100, y: 20 }, { x: 100, y: 20 }, LIST, 75)).toBe(false);
  });

  it('aims past the list by the tolerance', () => {
    // Aimed just past the list's bottom corner — held only with room for
    // the aim.
    const from = { x: 100, y: 290 };
    const to = { x: 110, y: 296 };
    expect(aimsAt(from, to, LIST, 0)).toBe(false);
    expect(aimsAt(from, to, LIST, 75)).toBe(true);
  });

  it('aims at a list on the left', () => {
    const left = new DOMRect(0, 0, 100, 300);
    expect(aimsAt({ x: 200, y: 20 }, { x: 190, y: 30 }, left, 0)).toBe(true);
    expect(aimsAt({ x: 200, y: 20 }, { x: 210, y: 30 }, left, 0)).toBe(false);
  });
});

@Component({
  imports: [MenuSafeTriangle],
  template: `<div class="menu" menuSafeTriangle>
    <div class="row opener" aria-expanded="true">Color</div>
    <div class="row crossed">Alignment</div>
    <div class="list" data-visible="true"><div class="row inner">Red</div></div>
  </div>`,
})
class Host {}

describe('MenuSafeTriangle', () => {
  let fixture: ComponentFixture<Host>;
  let heard: string[];

  const el = (selector: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector)!;
  const move = (x: number, y: number, on = '.opener') =>
    el(on).dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
  const over = (selector: string, x: number, y: number) =>
    el(selector).dispatchEvent(
      new MouseEvent('mouseover', { bubbles: true, clientX: x, clientY: y }),
    );

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    vi.useFakeTimers();
    vi.spyOn(el('.list'), 'getBoundingClientRect').mockReturnValue(LIST);
    heard = [];
    // The menu's own listener stands where Aria's does: bubbling on the host.
    el('.menu').addEventListener('mouseover', (e) =>
      heard.push((e.target as HTMLElement).className),
    );
    // jsdom has no hit testing: the replay asks what is under the pointer.
    document.elementFromPoint = () => el('.crossed');
  });

  afterEach(() => vi.useRealTimers());

  /** The pointer on its way right and down, from the opener into the
      crossed row below it — the hover first, then the move that caused
      it, as a browser sends them. */
  const diagonal = () => {
    move(100, 10);
    move(103, 13);
    move(106, 16);
    over('.crossed', 110, 21);
    move(110, 21, '.crossed');
  };

  it('holds back a hover on the way to the list', () => {
    diagonal();
    expect(heard).toEqual([]);
    expect(el('.menu').hasAttribute('data-grace')).toBe(true);
  });

  it('takes the oldest of the trail, so one step straight down still aims', () => {
    move(100, 10);
    move(104, 14);
    move(108, 18);
    // The last step is a pixel straight down — the heading is the trail's.
    over('.crossed', 108, 19);
    expect(heard).toEqual([]);
  });

  it('keeps holding while the pointer keeps heading for the list', () => {
    diagonal();
    vi.advanceTimersByTime(250);
    move(130, 30, '.crossed');
    move(140, 34, '.crossed');
    vi.advanceTimersByTime(100); // the first look: moved, still aiming
    expect(heard).toEqual([]);
    move(160, 40, '.crossed');
    vi.advanceTimersByTime(300); // the second look: moved, still aiming
    expect(heard).toEqual([]);
  });

  it('gives the row its hover once the pointer rests', () => {
    diagonal();
    vi.advanceTimersByTime(300);
    expect(heard).toEqual(['row crossed']);
    expect(el('.menu').hasAttribute('data-grace')).toBe(false);
  });

  it('gives the row its hover once the pointer turns away', () => {
    diagonal();
    move(100, 30, '.crossed');
    move(90, 35, '.crossed');
    move(80, 40, '.crossed');
    vi.advanceTimersByTime(300);
    expect(heard).toEqual(['row crossed']);
  });

  it('lets a pointer going straight down through at once', () => {
    move(100, 10);
    move(100, 14);
    move(100, 18);
    over('.crossed', 100, 22);
    expect(heard).toEqual(['row crossed']);
  });

  it('ends the grace in the list, with nothing to replay', () => {
    diagonal();
    over('.inner', 205, 40);
    expect(heard).toEqual(['row inner']);
    vi.advanceTimersByTime(1000);
    expect(heard).toEqual(['row inner']);
    expect(el('.menu').hasAttribute('data-grace')).toBe(false);
  });
});
