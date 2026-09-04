import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AddressInput } from './address-input';

/** A host the way the writer uses it: label, two-way addresses, a cap. */
@Component({
  imports: [AddressInput],
  template: `<div email-address-input label="To" [max]="max()" [(addresses)]="addresses"></div>`,
})
class Host {
  readonly addresses = signal<string[]>([]);
  readonly max = signal(Infinity);
}

describe('AddressInput', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let field: AddressInput;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    field = fixture.debugElement.query((el) => el.componentInstance instanceof AddressInput)
      .componentInstance as AddressInput;
  });

  it('shows its label and no chips to start', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.field-label')?.textContent).toBe('To');
    expect(root.querySelectorAll('mat-chip-row').length).toBe(0);
  });

  it('commits a run of addresses as chips — split on commas, semicolons, whitespace; deduplicated', async () => {
    field.commit('ada@example.com, grace@example.com; ada@example.com linus@example.com');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['ada@example.com', 'grace@example.com', 'linus@example.com']);
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('mat-chip-row').length).toBe(3);
  });

  it('flags a chip that is not an address instead of refusing it', async () => {
    field.commit('not-an-address');
    await fixture.whenStable();
    const chip = (fixture.nativeElement as HTMLElement).querySelector('mat-chip-row')!;
    expect(host.addresses()).toEqual(['not-an-address']);
    expect(chip.classList.contains('is-invalid')).toBe(true);
    expect(chip.getAttribute('aria-invalid')).toBe('true');
  });

  it('removes a chip', async () => {
    host.addresses.set(['ada@example.com', 'grace@example.com']);
    await fixture.whenStable();
    field.remove('ada@example.com');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['grace@example.com']);
  });

  it('caps at max and hides the input once full (From takes one)', async () => {
    host.max.set(1);
    await fixture.whenStable(); // the cap is an input: let it reach the field
    field.commit('me@example.com you@example.com');
    await fixture.whenStable();
    expect(host.addresses()).toEqual(['me@example.com']);
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      '.field-input',
    ) as HTMLInputElement;
    expect(input.hidden).toBe(true);
    field.remove('me@example.com');
    await fixture.whenStable();
    expect(input.hidden).toBe(false);
  });
});
