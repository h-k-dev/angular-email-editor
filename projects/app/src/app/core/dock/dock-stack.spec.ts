import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DockStack, STACK_CLOSE_DELAY } from './dock-stack';

/** An entry as an owner pushes it: nothing to do when pressed, here. */
const entry = (key: string, kind: string) => ({ key, kind, restore: () => {}, close: () => {} });

describe('DockStack', () => {
  let stack: DockStack;
  const occupied = signal(false);
  const place = signal(16);

  beforeEach(() => {
    occupied.set(false);
    place.set(16);
    stack = TestBed.inject(DockStack);
    stack.attach({ place, occupied });
  });

  it('holds whatever is pushed onto it, the last on top, and knows none of it', () => {
    stack.push(entry('compose:1', 'compose'));
    stack.push(entry('note:7', 'note'));
    stack.push(entry('compose:2', 'compose'));
    expect(stack.entries().map((entry) => entry.key)).toEqual(['compose:2', 'note:7', 'compose:1']);
    expect([stack.indexOf('compose:2'), stack.indexOf('compose:1'), stack.indexOf('nope')]).toEqual(
      [0, 2, -1],
    );

    // Pushed again, an entry goes back on top — never twice on the stack.
    stack.push(entry('note:7', 'note'));
    expect(stack.entries().map((entry) => entry.key)).toEqual(['note:7', 'compose:2', 'compose:1']);

    stack.remove('compose:2');
    expect(stack.entries().map((entry) => entry.key)).toEqual(['note:7', 'compose:1']);
  });

  it('stands where the edge says, and leaves its top bar there only with nothing open', () => {
    stack.push(entry('compose:1', 'compose'));
    stack.push(entry('compose:2', 'compose'));
    // Nothing open: the top bar shows, and the counter counts the rest.
    expect([stack.place(), stack.shown(), stack.hidden()]).toEqual([16, 1, 1]);

    // Something open: only the counter, counting them all.
    occupied.set(true);
    place.set(632);
    expect([stack.place(), stack.shown(), stack.hidden()]).toEqual([632, 0, 2]);

    // One entry and nothing open: its bar, and nothing for a counter.
    occupied.set(false);
    stack.remove('compose:2');
    expect([stack.shown(), stack.hidden()]).toEqual([1, 0]);
  });

  it('counts what is out of sight by kind, for one total and a bubble a kind', () => {
    occupied.set(true);
    stack.push(entry('compose:1', 'compose'));
    stack.push(entry('note:1', 'note'));
    stack.push(entry('compose:2', 'compose'));
    expect(stack.hidden()).toBe(3);
    expect([...stack.hiddenByKind()]).toEqual([
      ['compose', 2],
      ['note', 1],
    ]);

    // The bar on the edge is in sight: not counted.
    occupied.set(false);
    expect(stack.hidden()).toBe(2);
    expect([...stack.hiddenByKind()]).toEqual([
      ['note', 1],
      ['compose', 1],
    ]);
  });

  it('fans out, and folds a moment later — or at once; a push folds it', () => {
    vi.useFakeTimers();
    try {
      occupied.set(true);
      stack.push(entry('compose:1', 'compose'));
      stack.fan();
      expect(stack.open()).toBe(true);

      // Folding waits, so a pointer crossing to the next bar keeps it open.
      stack.fold();
      vi.advanceTimersByTime(STACK_CLOSE_DELAY / 2);
      stack.fan();
      vi.advanceTimersByTime(STACK_CLOSE_DELAY);
      expect(stack.open()).toBe(true);
      stack.fold();
      vi.advanceTimersByTime(STACK_CLOSE_DELAY);
      expect(stack.open()).toBe(false);

      stack.toggle();
      expect(stack.open()).toBe(true);
      stack.push(entry('compose:2', 'compose'));
      expect(stack.open()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists what is out of sight for its menu, named by whoever knows the name', () => {
    occupied.set(true);
    stack.push(entry('compose:1', 'compose'));
    stack.push(entry('note:1', 'note'));
    expect(stack.hiddenEntries().map((one) => one.key)).toEqual(['note:1', 'compose:1']);
    expect(stack.labelOf('note:1')).toBeUndefined();

    const subject = signal('Lunch?');
    const forget = stack.describe('compose:1', subject);
    expect(stack.labelOf('compose:1')).toBe('Lunch?');
    subject.set('Dinner?');
    expect(stack.labelOf('compose:1')).toBe('Dinner?');
    forget();
    expect(stack.labelOf('compose:1')).toBeUndefined();

    // The bar on the edge is not in the menu.
    occupied.set(false);
    expect(stack.hiddenEntries().map((one) => one.key)).toEqual(['compose:1']);
  });

  it('has nothing to fan with nothing out of sight', () => {
    stack.push(entry('compose:1', 'compose'));
    stack.fan();
    // Its one entry is the bar on the edge already.
    expect(stack.open()).toBe(false);
  });
});
