import { ApplicationRef, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Theme } from '../../../../../core/theme/theme';
import { Preferences } from '../../../../../core/storages/preferences';
import { Region } from '../../../../../core/translations/region';
import { AppSettingsSection, openAppSettings } from './app-settings';

describe('AppSettings', () => {
  const settle = () => TestBed.inject(ApplicationRef).whenStable();

  async function open(section = signal<AppSettingsSection | undefined>('appearance')) {
    const ref = openAppSettings(TestBed.inject(Injector), { section });
    await settle();
    const dialog = document.querySelector<HTMLElement>('.app-settings-pane [role="dialog"]')!;
    return { ref, dialog, section };
  }

  const pick = (dialog: HTMLElement, setting: string, words: string) =>
    [...dialog.querySelectorAll<HTMLElement>(`[data-setting="${setting}"] [role="radio"]`)].find(
      (item) => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === words,
    )!;

  afterEach(() =>
    document.querySelectorAll('.cdk-overlay-container').forEach((node) => node.remove()),
  );

  it('is a large dialog, the app theme first — System, the default, picked', async () => {
    const { ref, dialog } = await open();
    expect(document.querySelector('.cdk-overlay-pane')!.classList).toContain('dialog-large');
    expect(dialog.querySelector('h2')!.textContent?.trim()).toBe('Settings');
    expect(pick(dialog, 'theme', 'System').getAttribute('aria-checked')).toBe('true');

    pick(dialog, 'theme', 'Dark').click();
    await settle();
    expect(TestBed.inject(Theme).preference()).toBe('dark');
    expect(localStorage.getItem('angular-email-editor:theme')).toBe('dark');

    pick(dialog, 'theme', 'System').click();
    await settle();
    expect(TestBed.inject(Theme).preference()).toBe('system');
    expect(localStorage.getItem('angular-email-editor:theme')).toBeNull();
    ref.close();
  });

  it('switches the language, and keeps the open section for the next opening', async () => {
    const first = await open();
    [...first.dialog.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.textContent?.includes('Language'))!
      .click();
    await settle();
    pick(first.dialog, 'language', 'Deutsch').click();
    await settle();
    // The dictionary arrives later; the pick is there at once.
    expect(TestBed.inject(Preferences).language()).toBe('de');
    expect(first.section()).toBe('language');
    first.ref.close();
    await settle();

    const again = await open(first.section);
    const tabs = again.dialog.querySelectorAll('[role="tab"]');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    again.ref.close();
  });

  it('picks the calendar region apart from the language, and the minimum duration', async () => {
    const { ref, dialog } = await open(signal<AppSettingsSection | undefined>('calendar'));
    // The system's region (test-setup: Germany), said in the hint.
    expect(pick(dialog, 'region', 'System').getAttribute('aria-checked')).toBe('true');
    expect(dialog.textContent).toContain('Your system: Germany');
    expect(pick(dialog, 'min-duration', '15 min').getAttribute('aria-checked')).toBe('true');

    pick(dialog, 'region', 'Japan').click();
    pick(dialog, 'min-duration', '30 min').click();
    await settle();
    expect(TestBed.inject(Region).current()).toBe('JP');
    expect(localStorage.getItem('angular-email-editor:region')).toBe('JP');
    expect(TestBed.inject(Preferences).calendarMinDuration()).toBe(30);
    // The language never moved with it.
    expect(TestBed.inject(Preferences).language()).toBe('en');

    pick(dialog, 'region', 'System').click();
    await settle();
    expect(localStorage.getItem('angular-email-editor:region')).toBeNull();
    ref.close();
  });
});
