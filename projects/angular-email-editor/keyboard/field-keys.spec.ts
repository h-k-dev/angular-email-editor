import { Component, linkedSignal, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormField, debounce, form } from '@angular/forms/signals';
import { FieldKeys } from './field-keys';

/** A number field in a menu: the menu hears keys, the model snaps to 4. */
@Component({
  imports: [FormField, FieldKeys],
  template: `
    <div class="menu" (keydown)="menuKeys.push($event.key)">
      <input
        class="snapped"
        type="number"
        [formField]="fields.size"
        emailFieldKeys
        (emailFieldKeysCommitted)="said.push('committed')"
        (emailFieldKeysDismissed)="said.push('dismissed')"
      />
      <input class="plain" emailFieldKeys (emailFieldKeysCommitted)="said.push('plain')" />
    </div>
  `,
})
class Host {
  readonly menuKeys: string[] = [];
  readonly said: string[] = [];
  readonly stored = signal({ size: 8 });
  readonly model = linkedSignal(() => this.stored(), {
    set: ({ size }) => this.stored.set({ size: Math.round(size / 4) * 4 }),
  });
  readonly fields = form(this.model, (p) => debounce(p, 'blur'));
}

describe('FieldKeys', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let field: HTMLInputElement;

  const key = (target: HTMLElement, init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  const type = (text: string) => {
    field.value = text;
    field.dispatchEvent(new Event('input'));
  };

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    await fixture.whenStable();
    field = fixture.nativeElement.querySelector('input.snapped');
  });

  it('keeps typed keys from the menu round it; shortcuts with Ctrl or ⌘ still go up', () => {
    key(field, { key: '4' });
    key(field, { key: 'ArrowDown' });
    key(field, { key: 's', ctrlKey: true });
    key(field, { key: 'z', metaKey: true });
    expect(host.menuKeys).toEqual(['s', 'z']);
  });

  it('Enter commits the value to the model, says so, and shows what the model took', async () => {
    type('13');
    expect(host.stored().size).toBe(8);
    const enter = key(field, { key: 'Enter' });
    expect(enter.defaultPrevented).toBe(true);
    expect(host.stored().size).toBe(12);
    expect(host.said).toEqual(['committed']);
    await fixture.whenStable();
    expect(field.value).toBe('12');
  });

  it('a snap back onto the model’s own value still redraws the field', async () => {
    type('9');
    field.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(host.stored().size).toBe(8);
    expect(field.value).toBe('8');
    // …and the same typing again is still a change to the field.
    type('13');
    key(field, { key: 'Enter' });
    expect(host.stored().size).toBe(12);
  });

  it('Escape puts the field back as the model says, and says so', async () => {
    type('40');
    key(field, { key: 'Escape' });
    expect(host.said).toEqual(['dismissed']);
    expect(field.value).toBe('8');
    field.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(host.stored().size).toBe(8);
  });

  it('without a form field it only keeps the keys and says Enter', () => {
    const plain = fixture.nativeElement.querySelector('input.plain') as HTMLInputElement;
    key(plain, { key: 'a' });
    key(plain, { key: 'Enter' });
    expect(host.menuKeys).toEqual([]);
    expect(host.said).toEqual(['plain']);
  });
});
