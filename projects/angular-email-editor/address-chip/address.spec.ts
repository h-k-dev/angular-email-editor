import {
  formatMailbox,
  isEmailAddress,
  isMailbox,
  parseMailbox,
  separatesAt,
  splitAddresses,
} from './address';

describe('address helpers', () => {
  describe('isEmailAddress', () => {
    it('accepts something@something.tld and rejects the obvious typos', () => {
      expect(isEmailAddress('ada@example.com')).toBe(true);
      expect(isEmailAddress('ada.lovelace+math@sub.example.co.uk')).toBe(true);
      expect(isEmailAddress('ada')).toBe(false);
      expect(isEmailAddress('ada@example')).toBe(false);
      expect(isEmailAddress('ada @example.com')).toBe(false);
      expect(isEmailAddress('<ada@example.com>')).toBe(false);
    });
  });

  describe('parseMailbox', () => {
    it('takes a bare address as it is, trimmed', () => {
      expect(parseMailbox('  ada@example.com ')).toEqual({ address: 'ada@example.com' });
    });

    it('splits name <address>, quoted or not', () => {
      expect(parseMailbox('Ada Lovelace <ada@example.com>')).toEqual({
        name: 'Ada Lovelace',
        address: 'ada@example.com',
      });
      expect(parseMailbox('"Lovelace, Ada" <ada@example.com>')).toEqual({
        name: 'Lovelace, Ada',
        address: 'ada@example.com',
      });
    });

    it('drops empty angle-bracket names', () => {
      expect(parseMailbox('<ada@example.com>')).toEqual({ address: 'ada@example.com' });
      expect(parseMailbox('"" <ada@example.com>')).toEqual({ address: 'ada@example.com' });
    });
  });

  describe('formatMailbox', () => {
    it('round-trips, quoting a name only when it has to', () => {
      const plain = 'Ada Lovelace <ada@example.com>';
      const quoted = '"Lovelace, Ada" <ada@example.com>';
      expect(formatMailbox(parseMailbox(plain))).toBe(plain);
      expect(formatMailbox(parseMailbox(quoted))).toBe(quoted);
      expect(formatMailbox({ address: 'ada@example.com' })).toBe('ada@example.com');
    });

    it('escapes a quote inside a quoted name', () => {
      expect(formatMailbox({ name: 'Ada "the" Lovelace', address: 'a@b.co' })).toBe(
        '"Ada \\"the\\" Lovelace" <a@b.co>',
      );
    });
  });

  describe('isMailbox', () => {
    it('judges the address part, whatever the name', () => {
      expect(isMailbox('Ada <ada@example.com>')).toBe(true);
      expect(isMailbox('Ada <ada>')).toBe(false);
      expect(isMailbox('not-an-address')).toBe(false);
    });
  });

  describe('splitAddresses', () => {
    it('splits on commas, semicolons, line breaks and bare whitespace', () => {
      expect(splitAddresses('a@x.io, b@x.io; c@x.io\nd@x.io e@x.io')).toEqual([
        'a@x.io',
        'b@x.io',
        'c@x.io',
        'd@x.io',
        'e@x.io',
      ]);
    });

    it('keeps a display name whole, spaces and quoted commas included', () => {
      expect(
        splitAddresses('"Lovelace, Ada" <ada@x.io>, Grace Hopper <grace@x.io>;linus@x.io'),
      ).toEqual(['"Lovelace, Ada" <ada@x.io>', 'Grace Hopper <grace@x.io>', 'linus@x.io']);
    });

    it('drops empty tokens', () => {
      expect(splitAddresses(' , ;\n')).toEqual([]);
      expect(splitAddresses('a@x.io,,b@x.io,')).toEqual(['a@x.io', 'b@x.io']);
    });

    it('does not end a quoted name at an escaped quote', () => {
      expect(splitAddresses('"Ada \\"the, Countess\\" L" <ada@x.io>, b@x.io')).toEqual([
        '"Ada \\"the, Countess\\" L" <ada@x.io>',
        'b@x.io',
      ]);
    });

    it('repairs a bare name typed in front of an address', () => {
      expect(splitAddresses('Ada Lovelace ada@x.io')).toEqual(['Ada Lovelace <ada@x.io>']);
      expect(splitAddresses('Dr. Ada ada@x.io')).toEqual(['"Dr. Ada" <ada@x.io>']);
      // Each run of words names the address after it.
      expect(splitAddresses('a@x.io Grace Hopper g@x.io')).toEqual([
        'a@x.io',
        'Grace Hopper <g@x.io>',
      ]);
    });

    it('keeps words that name no address as one token, not one per word', () => {
      expect(splitAddresses('not an address')).toEqual(['not an address']);
      // A name still being typed after an address stays whole, after it.
      expect(splitAddresses('ada@x.io Grace Ho')).toEqual(['ada@x.io', 'Grace Ho']);
    });
  });

  describe('separatesAt', () => {
    it('is true outside quotes and angle brackets, false inside either', () => {
      expect(separatesAt('ada@x.io', 8)).toBe(true);
      expect(separatesAt('"Lovelace', 9)).toBe(false);
      expect(separatesAt('Ada <ada@x', 10)).toBe(false);
      expect(separatesAt('"Lovelace, Ada" <ada@x.io>', 26)).toBe(true);
      expect(separatesAt('"Ada \\"the', 10)).toBe(false);
    });

    it('judges the caret, not the end of the text', () => {
      expect(separatesAt('"Lovelace" x', 1)).toBe(false);
      expect(separatesAt('"Lovelace" x', 10)).toBe(true);
    });
  });
});
