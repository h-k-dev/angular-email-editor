import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, form } from '@angular/forms/signals';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { AddressInput, addressList } from 'angular-email-editor/address-input';
import { AddressFormField } from './address-form-field';

/** A host the way a Material app writes it: the label, hint and error are
    the form field's; the address input is its control, bound to a signal
    form. */
@Component({
  imports: [AddressInput, AddressFormField, FormField, MatFormField, MatLabel, MatHint, MatError],
  template: `
    <mat-form-field>
      <mat-label>To</mat-label>
      <div
        email-address-input
        emailMatFormField
        aria-describedby="own-note"
        [formField]="envelope.to"
      ></div>
      <mat-hint>Separate addresses with a comma</mat-hint>
      <mat-error>{{ envelope.to().errors()[0]?.message }}</mat-error>
    </mat-form-field>
    <p id="own-note">Recipients see each other.</p>
  `,
})
class Host {
  readonly model = signal({ to: [] as string[] });
  readonly envelope = form(this.model, (p) => addressList(p.to));
}

describe('AddressFormField', () => {
  let fixture: ComponentFixture<Host>;
  const root = () => fixture.nativeElement as HTMLElement;
  const field = () => root().querySelector<HTMLElement>('mat-form-field')!;
  const input = () => root().querySelector<HTMLInputElement>('[data-slot=input]')!;
  const label = () => root().querySelector<HTMLLabelElement>('label')!;
  const floats = () => label().classList.contains('mdc-floating-label--float-above');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
  });

  it('is the field’s control: the label is for its text field', () => {
    expect(label().getAttribute('for')).toBe(input().id);
    expect(field().querySelector('[email-address-input]')).not.toBeNull();
  });

  it('floats the label while focused, holding chips, or with something typed', async () => {
    expect(floats()).toBe(false);

    input().focus();
    await fixture.whenStable();
    expect(floats()).toBe(true);

    input().blur();
    input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await fixture.whenStable();
    expect(floats()).toBe(false);

    input().value = 'ad';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    expect(floats()).toBe(true);

    input().value = '';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    fixture.componentInstance.model.set({ to: ['ada@example.com'] });
    await fixture.whenStable();
    expect(floats()).toBe(true);
  });

  it('shows the error once the field is touched and invalid — the moment the input flags itself', async () => {
    expect(root().querySelector('mat-error')).toBeNull();
    input().dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(root().querySelector('mat-error')?.textContent).toContain('Add at least one address');
    expect(field().classList).toContain('mat-form-field-invalid');

    fixture.componentInstance.model.set({ to: ['ada@example.com'] });
    await fixture.whenStable();
    expect(root().querySelector('mat-error')).toBeNull();
  });

  it('the hint and the error are read out with the host’s own description', async () => {
    const described = () => input().getAttribute('aria-describedby')!.split(' ');
    const hint = root().querySelector('mat-hint')!.id;
    expect(described()).toEqual(expect.arrayContaining(['own-note', hint]));

    input().dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    const error = root().querySelector('mat-error')!.id;
    expect(described()).toEqual(expect.arrayContaining(['own-note', error]));
    expect(new Set(described()).size).toBe(described().length);
  });

  it('a click anywhere in the field puts the caret in', async () => {
    root().querySelector<HTMLElement>('.mat-mdc-text-field-wrapper')!.click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(input());
  });
});
