import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Region } from '../../../../core/translations/region';
import { I18n } from '../../../../core/translations/i18n';
import { MiniMonth } from './mini-month';

@Component({
  imports: [MiniMonth],
  template: `<mini-month [(month)]="month" today="2026-11-05" />`,
})
class Host {
  readonly month = signal('2026-11-05');
}

describe('MiniMonth — the calendar region', () => {
  const start = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const heads = () =>
      [...root.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    const firstWeek = () =>
      [...root.querySelector('tbody tr')!.querySelectorAll('[data-day]')].map(
        (day) => (day as HTMLElement).dataset['day'],
      );
    return { fixture, root, heads, firstWeek };
  };

  it('starts Germany’s weeks on Monday and numbers them — the Kalenderwoche first', async () => {
    const { root, heads, firstWeek } = await start();
    expect(heads()).toEqual(['', 'M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(firstWeek()[0]).toBe('2026-10-26');
    const numbers = [...root.querySelectorAll('.mini-month__week-number')];
    expect(numbers.map((th) => th.textContent?.trim())).toEqual([
      '44',
      '45',
      '46',
      '47',
      '48',
      '49',
      '50',
    ]);
    expect(numbers[0].getAttribute('aria-label')).toBe('Week 44');
    expect(root.querySelector('[data-weekend]')).toBeNull();
  });

  it('starts the UK’s on Monday, unnumbered', async () => {
    TestBed.inject(Region).choose('GB');
    const { root, heads, firstWeek } = await start();
    expect(heads()).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(firstWeek()[0]).toBe('2026-10-26');
    expect(root.querySelector('.mini-month__week-number')).toBeNull();
  });

  it('starts Japan’s on Sunday, its Saturdays blue and Sundays red', async () => {
    TestBed.inject(Region).choose('JP');
    const { root, heads, firstWeek } = await start();
    expect(heads()).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
    // November 2026 starts on a Sunday: its first row is its own.
    expect(firstWeek()[0]).toBe('2026-11-01');
    const weekend = (day: string) =>
      root.querySelector<HTMLElement>(`[data-day="${day}"]`)!.dataset['weekend'];
    expect(weekend('2026-11-07')).toBe('saturday');
    expect(weekend('2026-11-08')).toBe('sunday');
    expect(weekend('2026-11-09')).toBeUndefined();
  });

  it('keeps the region apart from the language: Japanese words over Germany’s weeks', async () => {
    TestBed.inject(I18n).use('ja');
    const { root, firstWeek } = await start();
    expect(firstWeek()[0]).toBe('2026-10-26');
    expect(root.querySelector('.mini-month__week-number')).not.toBeNull();
  });
});
