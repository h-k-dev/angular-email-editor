import { addressKey, isMailbox } from './address';
import {
  addressIdentity,
  decodeEncodedWords,
  formatMailbox,
  isEmailAddress,
  parseMailbox,
  separatesAt,
  splitAddresses,
} from './rules';

describe('our address rule', () => {
  // ── RFC coverage: every case core's own spec holds, then where we go
  // further. The file header of rules.ts lists what is implemented and
  // every deliberate deviation; these specs are that list, executable.

  describe('addr-spec (RFC 5322 §3.4.1, RFC 5321, RFC 6531)', () => {
    it('accepts the everyday shapes, and international ones', () => {
      for (const ok of [
        'jane.doe@example.co.uk',
        'ada.lovelace+math@sub.example.co.uk',
        "o'brien@example.ie",
        'kontakt@kanzlei-müller.de',
        'jörg@example.de',
        '用户@例子.广告',
        'a@x-y.de',
      ]) {
        expect(isEmailAddress(ok), ok).toBe(true);
      }
    });

    it('rejects specials, stray dots, whitespace and a missing or doubled @', () => {
      for (const bad of [
        'notanemail',
        'two@@x.com',
        'foo<a@b.de',
        'a,b@x.de',
        'a;b@x.de',
        'a:b@x.de',
        'foo(a@b.de',
        'a b@x.de',
        '.a@x.de',
        'a.@x.de',
        'a..b@x.de',
        'a@x.de.',
        'a@x..de',
        'a@.x.de',
        'a@-x.de',
        'a@x-.de',
      ]) {
        expect(isEmailAddress(bad), bad).toBe(false);
      }
    });

    it('takes a quoted local part — RFC-legal, which core turns away', () => {
      expect(isEmailAddress('"john doe"@example.com')).toBe(true);
      expect(isEmailAddress('"a@b"@example.com')).toBe(true);
      expect(isEmailAddress('"a\\"b"@example.com')).toBe(true);
      expect(isEmailAddress('"unclosed@example.com')).toBe(false);
    });

    it('takes an IPv4 or IPv6 address literal, and nothing else in brackets', () => {
      expect(isEmailAddress('a@[192.0.2.1]')).toBe(true);
      expect(isEmailAddress('a@[IPv6:2001:db8::1]')).toBe(true);
      expect(isEmailAddress('a@[300.0.0.1]')).toBe(false);
      expect(isEmailAddress('a@[example.com]')).toBe(false);
      expect(isEmailAddress('a@[IPv6:not-an-ip]')).toBe(false);
    });

    it('stricter on purpose: a domain needs a dot, and its top label is no number', () => {
      expect(isEmailAddress('missing@tld')).toBe(false);
      expect(isEmailAddress('a@1.2.3.4')).toBe(false);
    });

    it('enforces the RFC 5321 lengths in octets, not characters', () => {
      expect(isEmailAddress(`${'a'.repeat(64)}@x.de`)).toBe(true);
      expect(isEmailAddress(`${'a'.repeat(65)}@x.de`)).toBe(false);
      // 32 characters, 64 octets in UTF-8 — and 33 are 66.
      expect(isEmailAddress(`${'ü'.repeat(32)}@x.de`)).toBe(true);
      expect(isEmailAddress(`${'ü'.repeat(33)}@x.de`)).toBe(false);
      expect(isEmailAddress(`a@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(59)}.de`)).toBe(false);
      expect(isEmailAddress(`a@${'b'.repeat(64)}.de`)).toBe(false); // a label over 63
    });
  });

  describe('mailbox (RFC 5322 §3.4)', () => {
    it('reads back an escaped quote — the round trip core has and we had broken', () => {
      const wire = formatMailbox({ name: 'Hans "Hansi" Müller', address: 'h@x.de' });
      expect(wire).toBe('"Hans \\"Hansi\\" Müller" <h@x.de>');
      expect(parseMailbox(wire)).toEqual({ name: 'Hans "Hansi" Müller', address: 'h@x.de' });
      expect(isMailbox(wire)).toBe(true);
      const slash = formatMailbox({ name: 'a\\b', address: 'h@x.de' });
      expect(parseMailbox(slash)).toEqual({ name: 'a\\b', address: 'h@x.de' });
    });

    it('reads a phrase of atoms and quoted strings as one name', () => {
      expect(parseMailbox('Jane "J." Doe <j@x.de>')).toEqual({ name: 'Jane J. Doe', address: 'j@x.de' });
      expect(parseMailbox('Kiesewetter & Kollegen <iusta@iusta.io>')).toEqual({
        name: 'Kiesewetter & Kollegen',
        address: 'iusta@iusta.io',
      });
    });

    it('skips comments — and a comment after a bare address names it', () => {
      expect(parseMailbox('jane@x.io (Jane Doe)')).toEqual({ name: 'Jane Doe', address: 'jane@x.io' });
      expect(parseMailbox('Jane <jane@x.io> (work, (really))')).toEqual({ name: 'Jane', address: 'jane@x.io' });
      expect(parseMailbox('jane@x.io (a \\) b)')).toEqual({ name: 'a ) b', address: 'jane@x.io' });
    });

    it('drops an obsolete route (RFC 5322 §4.4)', () => {
      expect(parseMailbox('Jane <@relay.io,@hub.io:jane@x.io>')).toEqual({ name: 'Jane', address: 'jane@x.io' });
    });

    it('decodes RFC 2047 encoded words in a name, B and Q, joining adjacent ones', () => {
      expect(parseMailbox('=?UTF-8?B?SsO2cmc=?= <j@x.de>')).toEqual({ name: 'Jörg', address: 'j@x.de' });
      expect(parseMailbox('=?ISO-8859-1?Q?J=F6rg_M=FCller?= <j@x.de>')).toEqual({
        name: 'Jörg Müller',
        address: 'j@x.de',
      });
      expect(decodeEncodedWords('=?UTF-8?Q?a?= =?UTF-8?Q?b?=')).toBe('ab');
      expect(decodeEncodedWords('=?x-unknown?Q?a?=')).toBe('=?x-unknown?Q?a?=');
    });

    it('is ONE mailbox — an unclosed angle, trailing junk or a list fails', () => {
      expect(isMailbox('Jane <jane@x.com')).toBe(false);
      expect(isMailbox('Jane <jane@x.com> junk')).toBe(false);
      expect(isMailbox('a@x.com, b@y.com')).toBe(false);
      expect(isMailbox('Jane Doe <notanemail>')).toBe(false);
      expect(isMailbox('not an address')).toBe(false);
    });
  });

  describe('lists (RFC 5322 §3.4 address-list and group)', () => {
    it('yields a group’s members, and nothing for an empty group', () => {
      expect(splitAddresses('Team: a@x.io, b@x.io;, c@x.io')).toEqual(['a@x.io', 'b@x.io', 'c@x.io']);
      expect(splitAddresses('"My Team": a@x.io;')).toEqual(['a@x.io']);
      expect(splitAddresses('undisclosed-recipients:;')).toEqual([]);
      // No group without whitespace, a separator or the end after the colon.
      expect(splitAddresses('hans:müller@x.de')).toEqual(['hans:müller@x.de']);
    });

    it('keeps a comment with its address, and never splits inside one', () => {
      expect(splitAddresses('jane@x.io (Doe, Jane), b@x.io')).toEqual(['"Doe, Jane" <jane@x.io>', 'b@x.io']);
    });

    it('writes a well-formed mailbox in its canonical form, and a typo as typed', () => {
      expect(splitAddresses('<a@x.io>')).toEqual(['a@x.io']);
      expect(splitAddresses('Dr. Ada <a@x.io>')).toEqual(['"Dr. Ada" <a@x.io>']);
      expect(splitAddresses('=?UTF-8?B?SsO2cmc=?= <j@x.de>')).toEqual(['Jörg <j@x.de>']);
      expect(splitAddresses('Jane <jane@x>')).toEqual(['Jane <jane@x>']);
    });
  });

  describe('identity', () => {
    it('is one for one recipient: case, Unicode form and IDN spelling aside', () => {
      expect(addressIdentity('Ada@Example.COM')).toBe('ada@example.com');
      expect(addressIdentity('info@müller.de')).toBe('info@xn--mller-kva.de');
      expect(addressIdentity('jörg@x.de')).toBe(addressIdentity('jörg@x.de'));
    });
  });

  // ── the helpers, as the input and the chips use them ───────────────────
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

  describe('addressKey', () => {
    it('is the same for one recipient under any name or case', () => {
      expect(addressKey('Ada <ADA@Example.com>')).toBe('ada@example.com');
      expect(addressKey('"Lovelace, Ada" <ada@example.com>')).toBe('ada@example.com');
      expect(addressKey(' ada@example.com ')).toBe('ada@example.com');
      expect(addressKey('grace@example.com')).not.toBe(addressKey('ada@example.com'));
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
