import { TestBed } from '@angular/core/testing';
import { ADDRESS_RULES, AddressRules, addressKey, isMailbox, joinAddresses, provideAddressRules } from './address';
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

  describe('joinAddresses — the list as one header value', () => {
    it('joins with a comma, the names quoted where they have to be', () => {
      expect(joinAddresses(['Müller, Hans <h@x.de>', 'b@c.de'])).toBe('"Müller, Hans" <h@x.de>, b@c.de');
      expect(joinAddresses([])).toBe('');
      expect(joinAddresses([' ', 'a@b.de '])).toBe('a@b.de');
    });

    it('keeps what is no mailbox as it is — a typo, a placeholder', () => {
      expect(joinAddresses(['{{contact.email}}', 'ada@', 'x@y.de'])).toBe('{{contact.email}}, ada@, x@y.de');
    });

    it('comes back through the rule’s split, entry for entry', () => {
      const lists = [
        ['"Müller, Hans" <h@x.de>', 'b@c.de'],
        ['"Dr. Ada" <ada@x.io>', 'Kiesewetter & Kollegen <iusta@iusta.io>'],
        ['"Say \\"hi\\"" <q@x.io>', '"a b"@x.io'],
        ['{{contact.email}}', '"{{contact.name}}" <{{contact.email}}>', 'x@y.de'],
        ['Zoë Ångström <zoe@exämple.de>'],
      ];
      for (const list of lists) {
        expect(defaultAddressRules.split(joinAddresses(list))).toEqual(list);
      }
    });

    it('writes with whichever rule it is given', () => {
      const plain: AddressRules = { ...defaultAddressRules, format: (mailbox) => mailbox.address };
      expect(joinAddresses(['Ada <ada@x.io>', 'b@c.de'], plain)).toBe('ada@x.io, b@c.de');
    });
  });
});
