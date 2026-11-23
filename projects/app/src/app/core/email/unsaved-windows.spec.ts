import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { ComposeWindows } from './compose-windows';
import { provideUnsavedWindowsWarning } from './unsaved-windows';

describe('provideUnsavedWindowsWarning', () => {
  const windows = signal<readonly unknown[]>([]);

  beforeEach(() => {
    windows.set([]);
    TestBed.configureTestingModule({
      providers: [{ provide: ComposeWindows, useValue: { windows } }, provideUnsavedWindowsWarning()],
    });
    TestBed.inject(ApplicationRef);
  });

  /** A reload, as the page hears it: whether something asked to stay. */
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('asks before the page unloads only while a window is there', async () => {
    const listen = vi.spyOn(window, 'addEventListener');
    TestBed.tick();
    expect(unload()).toBe(false);
    // No window: not even listening — the page stays in the
    // back/forward cache.
    expect(listen.mock.calls.some(([type]) => type === 'beforeunload')).toBe(false);

    windows.set([{ id: 1 }]);
    TestBed.tick();
    expect(unload()).toBe(true);

    windows.set([]);
    TestBed.tick();
    expect(unload()).toBe(false);
  });
});
