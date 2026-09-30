import { TestBed } from '@angular/core/testing';
import { ADDRESS_RULES, AddressRules, addressKey, isMailbox, provideAddressRules } from './address';
import { defaultAddressRules } from './rules';

describe('address rules contract', () => {
  it('is ours unless a host provides its own', () => {
    expect(TestBed.inject(ADDRESS_RULES)).toBe(defaultAddressRules);
  });

  it('a host’s parts replace ours; the rest stay ours', () => {
    const isValid = (address: string) => address.endsWith('@iusta.io');
    TestBed.configureTestingModule({ providers: [provideAddressRules({ isValid })] });
    const rules = TestBed.inject(ADDRESS_RULES);
    expect(rules.isValid).toBe(isValid);
    expect(rules.parse).toBe(defaultAddressRules.parse);
    expect(isMailbox('Hong <hong@iusta.io>', rules)).toBe(true);
    expect(isMailbox('Ada <ada@example.com>', rules)).toBe(false);
  });

  it('the helpers ask whichever rule they are given', () => {
    const shouting: AddressRules = { ...defaultAddressRules, identity: (address) => address.toUpperCase() };
    expect(addressKey('Ada <ada@x.io>', shouting)).toBe('ADA@X.IO');
    expect(addressKey('Ada <ADA@X.io>')).toBe('ada@x.io');
  });
});
