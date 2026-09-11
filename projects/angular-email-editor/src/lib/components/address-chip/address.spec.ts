import { formatMailbox, isEmailAddress, isMailbox, parseMailbox, splitAddresses } from './address';

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
  });
});
