import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { atRest } from './at-rest';

describe('atRest', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes a write after a rest at once, and a burst only when it stops', async () => {
    const source = signal('a');
    const settled = runInInjectionContext(TestBed.inject(Injector), () =>
      atRest(source, { rest: 100, passes: (value) => value === 'echo' }),
    );
    const tick = async (ms = 0) => {
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(ms);
      TestBed.tick();
    };
    await tick(200);
    expect(settled.value()).toBe('a');

    // After a rest: at once.
    source.set('b');
    await tick();
    expect(settled.value()).toBe('b');

    // A burst — each key inside the rest window of the one before.
    for (const value of ['c', 'd', 'e']) {
      source.set(value);
      await tick(30);
    }
    expect(settled.value()).toBe('b');

    // It stops: the last one lands, nothing in between.
    await tick(100);
    expect(settled.value()).toBe('e');

    // A view's own echo passes at once and starts no burst: the write
    // right after it is still a first one.
    source.set('echo');
    await tick();
    expect(settled.value()).toBe('echo');
    source.set('f');
    await tick();
    expect(settled.value()).toBe('f');
  });
});
