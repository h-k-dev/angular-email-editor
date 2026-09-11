import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { scanningState } from './attachment-chip.animation';

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('scanningState', () => {
  it('is on while active, leaves for the exit stretch once it stops, then is gone', async () => {
    const active = signal(false);
    const state = TestBed.runInInjectionContext(() => scanningState(active, 40));
    TestBed.tick();
    expect(state()).toBeNull();

    active.set(true);
    TestBed.tick();
    expect(state()).toBe('true');

    active.set(false);
    // Leaving is there before anything flushes: the held value is still on.
    expect(state()).toBe('leaving');
    TestBed.tick();
    expect(state()).toBe('leaving');

    await settle(60);
    TestBed.tick();
    expect(state()).toBeNull();
  });

  it('never leaves when it was never on', () => {
    const active = signal(false);
    const state = TestBed.runInInjectionContext(() => scanningState(active, 40));
    TestBed.tick();
    active.set(false);
    TestBed.tick();

    expect(state()).toBeNull();
  });

  it('goes straight back on if activity returns mid-exit', async () => {
    const active = signal(true);
    const state = TestBed.runInInjectionContext(() => scanningState(active, 40));
    TestBed.tick();
    active.set(false);
    TestBed.tick();
    expect(state()).toBe('leaving');

    active.set(true);
    TestBed.tick();
    expect(state()).toBe('true');

    await settle(60);
    TestBed.tick();
    expect(state()).toBe('true');
  });
});
