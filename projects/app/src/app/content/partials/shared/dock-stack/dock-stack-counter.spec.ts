import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DockStack } from '../../../../core/dock/dock-stack';
import { DockStackItem } from '../../../../core/dock/dock-stack-item';

/** Something that is not a compose window, minimized onto the same stack:
    all it takes is the host directive, the name of its entry and what it
    is called. */
@Component({
  selector: 'div[test-note]',
  hostDirectives: [DockStackItem],
  template: `<button type="button">Note</button>`,
})
class TestNote {
  constructor() {
    inject(DockStackItem).bind(
      () => 'note:1',
      () => 'Call Ada',
    );
  }
}

/** A page with a note on it — and no counter or menu: the stack mounts its
    own layer for those, the first time anything goes onto it. */
@Component({
  imports: [TestNote],
  template: `<div test-note></div>`,
})
class Host {}

describe('DockStackCounter and DockStackMenu', () => {
  const occupied = signal(true);
  let stack: DockStack;
  const done: string[] = [];

  const entry = (key: string, kind: string, icon?: string) => ({
    key,
    kind,
    icon,
    restore: () => {
      done.push(`restore ${key}`);
      stack.remove(key);
    },
    close: () => {
      done.push(`close ${key}`);
      stack.remove(key);
    },
  });

  const mount = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    return {
      fixture,
      counter: () => document.querySelector<HTMLButtonElement>('[dock-stack-counter]'),
      menu: () => document.querySelector<HTMLElement>('[dock-stack-menu]'),
      rows: () => [...document.querySelectorAll<HTMLElement>('.dock-stack-menu__row')],
      note: () => root.querySelector<HTMLElement>('[test-note]')!,
    };
  };
  const nameOf = (row: Element) => row.querySelector<HTMLButtonElement>('.dock-stack-menu__name')!;

  afterEach(() => document.querySelector('[dock-stack-layer]')?.remove());

  beforeEach(() => {
    occupied.set(true);
    done.length = 0;
    stack = TestBed.inject(DockStack);
    stack.attach({ place: signal(632), occupied });
  });

  it('one stack and one counter for every kind of thing, with a bubble a kind once there are two', async () => {
    const { fixture, counter, note } = await mount();
    expect(counter()).toBeNull();

    stack.push(entry('compose:1', 'compose'));
    stack.push(entry('compose:2', 'compose'));
    await fixture.whenStable();
    // One kind: the total is all there is to say.
    expect(counter()!.firstChild!.textContent!.trim()).toBe('2');
    expect(counter()!.getAttribute('aria-label')).toBe('Minimized: 2');
    expect(counter()!.style.getPropertyValue('--dock-stack-x')).toBe('632px');
    expect(counter()!.querySelectorAll('.dock-stack-counter__kind')).toHaveLength(0);

    // A note minimizes onto the same stack: the same total counts it, and
    // each kind gets its own bubble.
    stack.push(entry('note:1', 'note'));
    await fixture.whenStable();
    expect(counter()!.firstChild!.textContent!.trim()).toBe('3');
    const bubbles = [...counter()!.querySelectorAll<HTMLElement>('.dock-stack-counter__kind')];
    expect(bubbles.map((bubble) => [bubble.dataset['kind'], bubble.textContent!.trim()])).toEqual([
      ['note', '1'],
      ['compose', '2'],
    ]);
    // Its element is on the stack like any other: out of sight and out of
    // reach, in the stack's place.
    expect(note().dataset['stacked']).toBe('0');
    expect(note().hasAttribute('inert')).toBe(true);
    expect(note().style.getPropertyValue('--dock-stack-x')).toBe('632px');
  });

  it('the menu is one panel of rows — every kind in it, named by its own element — that bring their entries back or close them', async () => {
    const { fixture, counter, menu, rows } = await mount();
    stack.push(entry('compose:1', 'compose', 'mail'));
    stack.push(entry('note:1', 'note', 'sticky_note_2'));
    await fixture.whenStable();
    expect(menu()).toBeNull();

    counter()!.click(); // no pointer behind it: a key's click
    await fixture.whenStable();
    expect(stack.open()).toBe(true);
    // The top of the stack first; the note named by its element, the other
    // (no element here) by its key.
    expect(rows().map((row) => [row.dataset['kind'], nameOf(row).textContent!.trim()])).toEqual([
      ['note', 'Call Ada'],
      ['compose', 'compose:1'],
    ]);
    expect(rows().map((row) => row.querySelector('mat-icon')!.textContent!.trim())).toEqual([
      'sticky_note_2',
      'mail',
    ]);
    // Rows and the gaps between them are the one panel's: a scroller, with
    // nothing behind them.
    expect(rows().every((row) => row.parentElement === menu())).toBe(true);
    // The focus is on the first row.
    expect(document.activeElement).toBe(nameOf(rows()[0]));

    // A row's name brings its entry back; its button closes it.
    nameOf(rows()[0]).click();
    await fixture.whenStable();
    rows()[0].querySelector<HTMLButtonElement>('.dock-stack-menu__close')!.click();
    await fixture.whenStable();
    expect(done).toEqual(['restore note:1', 'close compose:1']);
    // Nothing left out of sight: no menu, no counter.
    expect(menu()).toBeNull();
    expect(counter()).toBeNull();
  });

  it('the menu fades at an end that has more rows past it, and only there', async () => {
    const { fixture, counter, menu } = await mount();
    for (let i = 1; i <= 12; i++) stack.push(entry(`compose:${i}`, 'compose'));
    await fixture.whenStable();
    counter()!.click();
    await fixture.whenStable();
    // jsdom lays nothing out: say where the scroller is. It rests on its
    // foot — more above, nothing below.
    const at = async (scrollTop: number) => {
      Object.defineProperties(menu()!, {
        scrollHeight: { configurable: true, value: 600 },
        clientHeight: { configurable: true, value: 400 },
        scrollTop: { configurable: true, value: scrollTop },
      });
      menu()!.dispatchEvent(new Event('scroll'));
      await fixture.whenStable();
      return [menu()!.hasAttribute('data-more-above'), menu()!.hasAttribute('data-more-below')];
    };
    expect(await at(0)).toEqual([true, false]);
    expect(await at(-100)).toEqual([true, true]);
    expect(await at(-200)).toEqual([false, true]);
  });

  it('Escape in the menu closes it, the focus back on the counter', async () => {
    const { fixture, counter, menu, rows } = await mount();
    stack.push(entry('note:1', 'note'));
    await fixture.whenStable();
    counter()!.click();
    await fixture.whenStable();

    nameOf(rows()[0]).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();
    expect(stack.open()).toBe(false);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(counter());
  });

  it('with nothing open on the edge it stands beside the bar left there, counting the rest', async () => {
    occupied.set(false);
    const { fixture, counter, menu, rows, note } = await mount();
    stack.push(entry('compose:1', 'compose'));
    stack.push(entry('note:1', 'note'));
    await fixture.whenStable();
    expect(note().hasAttribute('data-stack-top')).toBe(true);
    expect(note().hasAttribute('inert')).toBe(false);
    expect(note().style.getPropertyValue('--dock-stack-counter')).toBe('48px');
    expect(counter()!.classList).toContain('dock-stack-counter--beside');
    expect(counter()!.firstChild!.textContent!.trim()).toBe('1');
    expect(counter()!.getAttribute('aria-label')).toBe('More minimized: 1');

    // A pointer over the bar on the edge opens the menu too — of the
    // rest: the bar is not a row of it.
    note().dispatchEvent(new Event('pointerenter'));
    await fixture.whenStable();
    expect(menu()).not.toBeNull();
    expect(rows().map((row) => nameOf(row).textContent!.trim())).toEqual(['compose:1']);
  });
});
