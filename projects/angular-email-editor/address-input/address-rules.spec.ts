import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import { defaultAddressRules, provideAddressRules } from '@h-k-dev/angular-email-editor/address';
import {
  ADDRESS_LIST_EMPTY,
  ADDRESS_LIST_INVALID,
  ADDRESS_LIST_TOO_MANY,
  addressText,
  type AddressListOptions,
} from './address-rules';

/** A one-field form whose `email` is judged by `addressText`. */
function contact(email: string, options?: AddressListOptions) {
  const model = signal({ email });
  const fields = TestBed.runInInjectionContext(() => form(model, (p) => addressText(p.email, options)));
  return { model, email: fields.email };
}

const kinds = (field: ReturnType<typeof contact>['email']) =>
  field()
    .errors()
    .map((e) => e.kind);

describe('addressText', () => {
  it('takes a bare address, a display name, and several of either', () => {
    expect(contact('malte.wunderlich@iusta.io').email().valid()).toBe(true);
    expect(contact('Malte Wunderlich <malte.wunderlich@iusta.io>').email().valid()).toBe(true);
    expect(contact('"Wunderlich, Malte" <malte@iusta.io>').email().valid()).toBe(true);
    expect(contact('Person1 <mail1@domain.com>, Person2 <mail2@domain.com>').email().valid()).toBe(true);
    expect(contact('a@x.io; b@x.io\nc@x.io').email().valid()).toBe(true);
    expect(contact('jörg@müller.de').email().valid()).toBe(true);
  });

  it('lets an empty field through — clearing stays a clear — unless told a minimum', () => {
    expect(contact('').email().valid()).toBe(true);
    expect(contact('   ').email().valid()).toBe(true);
    expect(kinds(contact('', { min: 1 }).email)).toEqual([ADDRESS_LIST_EMPTY]);
  });

  it('names the offenders, and only them', () => {
    const { email } = contact('Ada <ada@x.io>, nope, hans@gmail');
    expect(email().errors().map((e) => [e.kind, e.message])).toEqual([
      [ADDRESS_LIST_INVALID, '“nope” and 1 other are not email addresses'],
    ]);
  });

  it('holds a single-mailbox field to one, display name and all', () => {
    expect(contact('Ada <ada@x.io>', { max: 1 }).email().valid()).toBe(true);
    expect(kinds(contact('ada@x.io, bob@x.io', { max: 1 }).email)).toEqual([ADDRESS_LIST_TOO_MANY]);
  });

  it('judges again when the value changes', () => {
    const { model, email } = contact('nope');
    expect(email().valid()).toBe(false);
    model.set({ email: 'Ada <ada@x.io>' });
    expect(email().valid()).toBe(true);
  });

  it('lets a placeholder a template fills in through', () => {
    expect(contact('"{{contact.name}}" <{{contact.email}}>').email().valid()).toBe(true);
  });

  it('words the errors as the host says', () => {
    const { email } = contact('nope', { messages: { invalid: () => 'ERROR.EMAIL' } });
    expect(email().errors().map((e) => e.message)).toEqual(['ERROR.EMAIL']);
  });

  it('splits and judges by the rule in force, or the one passed', () => {
    TestBed.configureTestingModule({ providers: [provideAddressRules({ isValid: () => false })] });
    expect(contact('ada@x.io').email().valid()).toBe(false);
    expect(contact('ada@x.io', { rules: defaultAddressRules }).email().valid()).toBe(true);
  });
});
