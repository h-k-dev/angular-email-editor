import { TestBed } from '@angular/core/testing';
import { LocalStorage } from './local-storage';

/** What the browser dispatches in *other* tabs when one writes. */
function otherTab(key: string | null, newValue: string | null): void {
  if (key === null) localStorage.clear();
  else if (newValue === null) localStorage.removeItem(key);
  else localStorage.setItem(key, newValue);
  window.dispatchEvent(new StorageEvent('storage', { key, newValue, storageArea: localStorage }));
}

describe('LocalStorage', () => {
  let service: LocalStorage;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(LocalStorage);
  });

  afterEach(() => localStorage.clear());

  it('pairs a signal with a key: it reads what storage holds, null for an unset key', () => {
    localStorage.setItem('a', 'stored');
    expect(service.pairSignal('a')()).toBe('stored');
    expect(service.pairSignal('b')()).toBeNull();
  });

  it('writes through: set stores the value, null removes the key, and the signal follows at once', () => {
    const a = service.pairSignal('a');
    a.set('one');
    expect(localStorage.getItem('a')).toBe('one');
    expect(a()).toBe('one');

    a.update((value) => `${value}+two`);
    expect(localStorage.getItem('a')).toBe('one+two');

    a.set(null);
    expect(localStorage.getItem('a')).toBeNull();
    expect(a()).toBeNull();
  });

  it('hands every caller the same signal for a key', () => {
    expect(service.pairSignal('a')).toBe(service.pairSignal('a'));
  });

  it("follows another tab's writes, removals and clear()", () => {
    const a = service.pairSignal('a');
    const b = service.pairSignal('b');

    otherTab('a', 'from elsewhere');
    expect(a()).toBe('from elsewhere');
    expect(b()).toBeNull();

    otherTab('b', 'also');
    otherTab('a', null);
    expect(a()).toBeNull();
    expect(b()).toBe('also');

    localStorage.setItem('a', 'back');
    otherTab(null, null);
    expect(b()).toBeNull();
    expect(a()).toBeNull();
  });

  it('ignores events for another storage area', () => {
    const a = service.pairSignal('a');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'a', newValue: 'elsewhere', storageArea: null }),
    );
    expect(a()).toBeNull();
  });

  it('reports a write storage refuses, and keeps the signal on what storage still holds', () => {
    const a = service.pairSignal('a');
    a.set('kept');
    const setItem = vi
      .spyOn(Object.getPrototypeOf(localStorage), 'setItem')
      .mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
    try {
      expect(service.setItem('a', 'too big')).toBe(false);
      a.set('also too big');
      expect(a()).toBe('kept');
      expect(localStorage.getItem('a')).toBe('kept');
    } finally {
      setItem.mockRestore();
    }
    expect(service.setItem('a', 'fits')).toBe(true);
    expect(a()).toBe('fits');
  });
});
