import { TestBed } from '@angular/core/testing';
import { Theme } from './theme';

const KEY = 'angular-email-editor:theme';

describe('Theme', () => {
  it('follows the system until a theme is chosen — jsdom has no dark system', () => {
    const theme = TestBed.inject(Theme);
    expect(theme.preference()).toBe('system');
    expect(theme.scheme()).toBe('light');
  });

  it('a scheme of its own, kept by this browser — the system again removes it', () => {
    const theme = TestBed.inject(Theme);
    theme.choose('dark');
    expect(theme.scheme()).toBe('dark');
    expect(localStorage.getItem(KEY)).toBe('dark');
    theme.choose('light');
    expect(theme.preference()).toBe('light');
    expect(localStorage.getItem(KEY)).toBe('light');

    theme.choose('system');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(theme.scheme()).toBe('light');
  });

  it('starts on the kept theme, takes another tab’s, and reads a stranger as the system', () => {
    localStorage.setItem(KEY, 'dark');
    const theme = TestBed.inject(Theme);
    expect(theme.scheme()).toBe('dark');

    localStorage.setItem(KEY, 'sepia');
    window.dispatchEvent(
      new StorageEvent('storage', { key: KEY, newValue: 'sepia', storageArea: localStorage }),
    );
    expect(theme.preference()).toBe('system');
    expect(theme.scheme()).toBe('light');
  });
});
