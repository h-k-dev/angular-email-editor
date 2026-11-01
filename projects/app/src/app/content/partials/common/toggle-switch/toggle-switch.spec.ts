import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormField, disabled, form } from '@angular/forms/signals';

import { ToggleSwitch } from './toggle-switch';

@Component({
  imports: [FormField, ToggleSwitch],
  template: `
    <label>
      <button toggleSwitch [formField]="settings.allDay"></button>
      All day
    </label>
  `,
})
class Host {
  readonly model = signal({ allDay: false });
  readonly locked = signal(false);
  readonly settings = form(this.model, (p) => disabled(p.allDay, () => this.locked()));
}

describe('ToggleSwitch', () => {
  const start = async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const button = root.querySelector<HTMLButtonElement>('button[toggleSwitch]')!;
    return { fixture, root, button };
  };

  it('is a switch: a button that says its state in aria-checked', async () => {
    const { button } = await start();
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('aria-checked')).toBe('false');
  });

  it('turns the form’s field — from itself, and from the words of its label', async () => {
    const { fixture, root, button } = await start();
    button.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.model().allDay).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');

    root.querySelector('label')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.model().allDay).toBe(false);
  });

  it('follows the field: its value, and its disabled state', async () => {
    const { fixture, button } = await start();
    fixture.componentInstance.model.set({ allDay: true });
    fixture.componentInstance.locked.set(true);
    await fixture.whenStable();
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(button.disabled).toBe(true);
  });
});
