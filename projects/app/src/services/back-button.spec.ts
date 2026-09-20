import { TestBed } from '@angular/core/testing';

import { BackButton } from './back-button';

/** A back press, and the popstate it fires — jsdom's traversal is
    asynchronous, like a browser's. */
const pressBack = async () => {
  history.back();
  await new Promise((resolve) => setTimeout(resolve, 40));
};

/** The forward button, the same way. */
const pressForward = async () => {
  history.forward();
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
    back.guard({ dismiss });

    // One entry more, same page.
    expect(location.href).toBe(here);
    expect(history.state?.__backGuard).toBeDefined();

    await pressBack();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(location.href).toBe(here);
    expect(history.state?.__backGuard).toBeUndefined();

    // Spent — it said nothing about coming back: the forward button walks
    // into an entry with nothing on it, and the next back press is the
    // page's own again.
    await pressForward();
    await pressBack();
    expect(dismiss).toHaveBeenCalledOnce();
    await pressBack();
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("a mark left by the page's last life is no guard of this one", async () => {
    // A refresh while something was open: the entry keeps its mark, the
    // guard it named went with the page, and the keys count from 1 again —
    // so the mark would otherwise read as a guard ahead of every new one,
    // and the press onto it would close nothing.
    const entry = history.state;
    history.replaceState({ __backGuard: 7, __backGuardLife: 'before the refresh' }, '');
    try {
      const dismiss = vi.fn();
      back.guard({ dismiss });

      await pressBack();
      expect(dismiss).toHaveBeenCalledOnce();
    } finally {
      // The entry is the one every spec here starts from: leave it as found.
      history.replaceState(entry, '');
    }
  });

  it('closing some other way takes the guard down, and its entry with it', async () => {
    const dismiss = vi.fn();
    const { release } = back.guard({ dismiss });

    release();
    await settle();
    expect(history.state?.__backGuard).toBeUndefined();

    await pressBack();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('stacks: the press closes the newest, then the one under it', async () => {
    const order: string[] = [];
    back.guard({ dismiss: () => order.push('first') });
    back.guard({ dismiss: () => order.push('second') });

    await pressBack();
    expect(order).toEqual(['second']);
    await pressBack();
    expect(order).toEqual(['second', 'first']);
  });

  it('a guard released under another one lapses quietly when its turn comes', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { release: releaseFirst } = back.guard({ dismiss: first });
    back.guard({ dismiss: second });

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
    back.guard({ dismiss: () => order.push('first') });
    back.guard({ dismiss: () => order.push('second') });

    // The browser landing on an entry from before both guards — a long
    // press on the back button, or a pick from its menu. The landing is
    // what is under test, so it is staged here: jsdom's own `go(-2)`
    // traverses a single entry, whatever it is asked for.
    history.replaceState({}, '');
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));

    expect(order).toEqual(['second', 'first']);
  });

  it('the forward button puts back what the back press closed', async () => {
    const dismiss = vi.fn();
    const restore = vi.fn();
    back.guard({ dismiss, restore });

    await pressBack();
    expect(dismiss).toHaveBeenCalledOnce();
    expect(restore).not.toHaveBeenCalled();

    await pressForward();
    expect(restore).toHaveBeenCalledOnce();
    expect(history.state?.__backGuard).toBeDefined();

    // And the guard is standing on its entry again: the press after that
    // closes what came back, once more.
    await pressBack();
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it('what comes back arms its guard on the entry it came back on, never a second one', async () => {
    const dismiss = vi.fn();
    const held = back.guard({ dismiss, restore: () => {} });
    await pressBack();
    await pressForward();

    // What the forward press put back is a new thing with its own way out:
    // it takes over the entry it arrived on instead of pushing another, so
    // a message closed and brought back all afternoon leaves the history
    // exactly as long as it found it.
    const entries = history.length;
    const again = vi.fn();
    const next = back.guard({ dismiss: again, adopt: held.key });
    expect(next.key).toBe(held.key);
    expect(history.length).toBe(entries);

    await pressBack();
    expect(again).toHaveBeenCalledOnce();
    // The entry closes what is on it now, not what was.
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('closed by hand, there is nothing for the forward button to give back', async () => {
    const restore = vi.fn();
    const { release } = back.guard({ dismiss: () => {}, restore });

    release();
    await settle();
    await pressForward();
    expect(restore).not.toHaveBeenCalled();
  });
});
