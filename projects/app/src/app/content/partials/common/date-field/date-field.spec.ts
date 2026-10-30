import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';
import { OverlayContainer } from '@angular/cdk/overlay';

import { DateField } from './date-field';

@Component({
  imports: [DateField, FormField],
  template: `<date-field [formField]="fields.day" fieldLabel="Starts" />`,
})
class Host {
  readonly model = signal({ day: '2026-10-30' });
  readonly fields = form(this.model);
}

describe('DateField', () => {
  const start = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const overlay = TestBed.inject(OverlayContainer).getContainerElement();
    const trigger = root.querySelector<HTMLButtonElement>('.date-field__trigger')!;
    return { fixture, trigger, overlay };
  };

  it('shows the form’s day on a quiet field, named for what it is', async () => {
    const { trigger } = await start();
    expect(trigger.classList).toContain('quiet-field');
    expect(trigger.textContent?.trim()).toBe('Fri, Oct 30, 2026');
    expect(trigger.getAttribute('aria-label')).toBe('Starts: Fri, Oct 30, 2026');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the mini month on the day, and a day picked is the form’s', async () => {
    const { fixture, trigger, overlay } = await start();
    trigger.click();
    await fixture.whenStable();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // The picked day washed: the one the field shows.
    expect(
      overlay.querySelector('[aria-selected="true"] [data-day]')?.getAttribute('data-day'),
    ).toBe('2026-10-30');

    overlay.querySelector<HTMLButtonElement>('[data-day="2026-10-14"]')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.model().day).toBe('2026-10-14');
    expect(trigger.textContent?.trim()).toBe('Wed, Oct 14, 2026');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    // Back on the field after the pick.
    expect(document.activeElement).toBe(trigger);
  });
});
