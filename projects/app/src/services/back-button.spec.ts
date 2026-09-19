import { TestBed } from '@angular/core/testing';

import { BackButton } from './back-button';

/** A back press, and the popstate it fires — jsdom's traversal is
    asynchronous, like a browser's. */
const pressBack = async () => {
  history.back();
  await new Promise((resolve) => setTimeout(resolve, 40));
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

describe('BackButton', () => {
  let back: BackButton;

  beforeEach(() => {
    back = TestBed.inject(BackButton);
  });

  it('takes the next back press for what it guards, instead of leaving the page', async () => {
    const here = location.href;
    const dismiss = vi.fn();
    back.guard(dismiss);

    // One entry more, same page.
    expect(location.href).toBe(here);
    expect(history.state?.__backGuard).toBeDefined();

    await pressBack();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(location.href).toBe(here);
    expect(history.state?.__backGuard).toBeUndefined();

    // Spent: the guard is gone with its entry, and the next press is the
    // page's own again.
    await pressBack();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('closing some other way takes the guard down, and its entry with it', async () => {
    const dismiss = vi.fn();
    const release = back.guard(dismiss);

    release();
    await settle();
    expect(history.state?.__backGuard).toBeUndefined();

    await pressBack();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('stacks: the press closes the newest, then the one under it', async () => {
    const order: string[] = [];
    back.guard(() => order.push('first'));
    back.guard(() => order.push('second'));

    await pressBack();
    expect(order).toEqual(['second']);
    await pressBack();
    expect(order).toEqual(['second', 'first']);
  });

  it('a guard released under another one lapses quietly when its turn comes', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = back.guard(first);
    back.guard(second);

    // The older one closed by itself while the newer is still up: its entry
    // cannot go yet, and must close nothing when it does.
    releaseFirst();
    await settle();

    await pressBack();
    expect(second).toHaveBeenCalledOnce();
    await settle();
    expect(first).not.toHaveBeenCalled();
  });

  it('a press that lands past several guards closes them all, newest first', () => {
    const order: string[] = [];
    back.guard(() => order.push('first'));
    back.guard(() => order.push('second'));

    // The browser landing on an entry from before both guards — a long
    // press on the back button, or a pick from its menu. The landing is
    // what is under test, so it is staged here: jsdom's own `go(-2)`
    // traverses a single entry, whatever it is asked for.
    history.replaceState({}, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));

    expect(order).toEqual(['second', 'first']);
  });
});
