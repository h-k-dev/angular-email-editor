import type { AddressRules, Mailbox } from './address';

/**
 * **Our address rule** — the one place that decides what an email address
 * is, how a mailbox is read and written, and how typed or pasted text splits
 * into mailboxes. Everything else in the library asks through
 * {@link AddressRules}; a host that wants another rule provides its own
 * (`provideAddressRules`) and this file is simply not used.
 *
 * Kept as a living document: what it implements, and every place it
 * deliberately does less or more than the RFCs, is listed here — change the
 * list with the code.
 *
 * **Implements**
 * - RFC 5322 §3.4 `mailbox`: `addr-spec` or `name-addr` — a phrase of atoms
 *   and quoted strings (quoted-pairs unescaped) in front of an `angle-addr`.
 * - RFC 5322 §3.2.2 comments, nested, with quoted-pairs: skipped — and a
 *   comment after a bare address names it (`jane@x.io (Jane Doe)`), the
 *   de facto reading of the old form.
 * - RFC 5322 §3.4 `group`: `Team: a@x.io, b@x.io;` yields its members; an
 *   empty group (`undisclosed-recipients:;`) yields nothing.
 * - RFC 5322 §4.4 obsolete routes: `<@relay.io:jane@x.io>` is `jane@x.io`.
 * - RFC 5322 §3.4.1 `addr-spec`: a dot-atom or quoted-string local part.
 * - RFC 6532 / 6531: UTF-8 in local parts, names and domains (`jörg@müller.de`).
 * - RFC 5321 §4.1.2 / 4.1.3 domains: LDH labels of 1–63 characters, no
 *   hyphen at either end; address literals `[192.0.2.1]` and `[IPv6:…]`.
 * - RFC 5321 §4.5.3.1 lengths, in octets (UTF-8): local part ≤ 64,
 *   address ≤ 254 (the 256-octet path less its brackets, RFC 3696 errata).
 * - RFC 2047 encoded words in names (`=?UTF-8?B?…?=`, `Q` too, any charset
 *   the platform's `TextDecoder` knows), adjacent words joined as §6.2 says.
 *
 * **Deliberately stricter than the RFCs** — the typo worth catching:
 * - A domain needs a dot (`hans@gmail` is legal, and a typo every time).
 * - A top-level label is not all digits (RFC 3696 §2) — `a@1.2.3.4` is an
 *   IP address missing its brackets.
 * - General address literals (`[tag:content]`) are refused; only IPv4/IPv6.
 *
 * **Deliberately more lenient — people type these:**
 * - `,` `;` and line breaks all separate (RFC 5322: only `,`).
 * - A bare run is read as people type it: words in front of an address name
 *   it (`Ada Lovelace ada@x.io`), addresses only whitespace separates are
 *   several, words naming no address stay one token (one typo, not three).
 * - A group needs whitespace, `;`, `,` or the end after its colon, so
 *   `hans:müller@x.de` stays one (invalid) address instead of silently
 *   becoming `müller@x.de` under a group called `hans`.
 */

// ── characters ───────────────────────────────────────────────────────────

/** RFC 5322 `atext`, plus RFC 6532's UTF-8 beyond ASCII. */
const ATEXT = "A-Za-z0-9!#$%&'*+/=?^_`{|}~\\-\\u0080-\\u{10FFFF}";
const DOT_ATOM = new RegExp(`^[${ATEXT}]+(?:\\.[${ATEXT}]+)*$`, 'u');
/** RFC 5322 `quoted-string` as a whole local part: qtext, quoted-pairs, spaces. */
const QUOTED_LOCAL = /^"(?:[\x20\x21\x23-\x5B\x5D-\x7E\u0080-\u{10FFFF}]|\\[\x20-\x7E])*"$/u;
/** An RFC 5321 label, with RFC 6531 U-labels: letters and digits of any
    script, hyphens inside. */
const LABEL = /^(?!-)[\p{L}\p{N}\p{M}-]{1,63}(?<!-)$/u;
/** Characters a display name must be quoted to carry: RFC 5322's specials. */
const SPECIALS = /[()<>[\]:;@\\,."]/;

const octets = (text: string): number => new TextEncoder().encode(text).length;

// ── addr-spec ────────────────────────────────────────────────────────────

/** Whether a bare address — no name, no brackets — is well-formed by the
    rule above. */
export function isEmailAddress(address: string): boolean {
  const at = address.lastIndexOf('@');
  if (at < 1 || at === address.length - 1) return false;
  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  if (octets(local) > 64 || octets(address) > 254) return false;
  if (!DOT_ATOM.test(local) && !QUOTED_LOCAL.test(local)) return false;
  return isDomain(domain);
}

function isDomain(domain: string): boolean {
  if (domain.startsWith('[')) return isAddressLiteral(domain);
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return false;
  return !/^\d+$/.test(labels[labels.length - 1]);
}

function isAddressLiteral(literal: string): boolean {
  const inner = /^\[(.*)\]$/.exec(literal)?.[1];
  if (inner === undefined) return false;
  if (/^IPv6:/i.test(inner)) return isIPv6(inner.slice(5));
  return isIPv4(inner);
}

function isIPv4(text: string): boolean {
  const parts = text.split('.');
  return parts.length === 4 && parts.every((part) => /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(part));
}

function isIPv6(text: string): boolean {
  // The platform's own parser is the reference; the shape check keeps a
  // host name or a port from sneaking through it.
  if (!/^[0-9A-Fa-f:.]+$/.test(text) || !text.includes(':')) return false;
  try {
    return new URL(`http://[${text}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

// ── the mailbox scanner ──────────────────────────────────────────────────

/** Where the scan stands at one character: inside a quoted string, a
    comment (nested), or angle brackets. */
interface ScanState {
  quoted: boolean;
  comment: number;
  angled: boolean;
  escaped: boolean;
}

const at_top = (state: ScanState) => !state.quoted && !state.comment && !state.angled;

/** Steps the scan past one character; true when the character is structure
    (a quote, a bracket, part of a comment or an escape), not content at the
    top level. */
function step(state: ScanState, char: string): boolean {
  if (state.escaped) {
    state.escaped = false;
    return true;
  }
  if ((state.quoted || state.comment) && char === '\\') {
    state.escaped = true;
    return true;
  }
  if (state.quoted) {
    if (char === '"') state.quoted = false;
    return true;
  }
  if (state.comment) {
    if (char === '(') state.comment++;
    else if (char === ')') state.comment--;
    return true;
  }
  if (char === '"' && !state.angled) {
    state.quoted = true;
    return true;
  }
  if (char === '(' && !state.angled) {
    state.comment = 1;
    return true;
  }
  if (char === '<') state.angled = true;
  else if (char === '>') state.angled = false;
  else return state.angled;
  return true;
}

const fresh = (): ScanState => ({ quoted: false, comment: 0, angled: false, escaped: false });

/** Whether a separator typed at `caret` would separate — false inside a
    quoted name, a comment or angle brackets, where a comma is part of the
    mailbox: `"Lovelace, Ada"`. */
export function separatesAt(raw: string, caret: number): boolean {
  const state = fresh();
  for (const char of raw.slice(0, caret)) step(state, char);
  return at_top(state) && !state.escaped;
}

// ── parse ────────────────────────────────────────────────────────────────

/**
 * Splits a header-form mailbox into name and address: quoted strings
 * unquoted and unescaped, encoded words decoded, comments skipped — or, after
 * a bare address, taken as its name — and an obsolete route dropped.
 * Anything that is no mailbox comes back as its trimmed text, as the address,
 * for the rule to refuse.
 */
export function parseMailbox(raw: string): Mailbox {
  const text = raw.trim();
  const words: string[] = [];
  const comments: string[] = [];
  let address: string | null = null;
  let bare = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      const end = closing(text, i, '"');
      if (end < 0) return { address: text };
      words.push(unescape(text.slice(i + 1, end)));
      i = end + 1;
    } else if (char === '(') {
      const end = closingComment(text, i);
      if (end < 0) return { address: text };
      comments.push(decodeEncodedWords(unescape(text.slice(i + 1, end)).trim()));
      i = end + 1;
    } else if (char === '<') {
      const end = text.indexOf('>', i);
      if (end < 0 || address !== null) return { address: text };
      address = text.slice(i + 1, end).trim().replace(/^@[^:]*:/, '');
      i = end + 1;
    } else if (/\s/.test(char)) {
      i++;
    } else {
      let end = i;
      while (end < text.length && !/[\s"(<]/.test(text[end])) end++;
      const atom = text.slice(i, end);
      if (address === null) words.push(atom);
      else return { address: text }; // text after the angle-addr
      bare += atom;
      i = end;
    }
  }
  if (address !== null) {
    const name = phrase(words) || comments.join(' ');
    return name ? { name, address } : { address };
  }
  // No angle brackets: an addr-spec, as one run of text.
  if (words.length !== 1 || !bare) return { address: text };
  const name = comments.join(' ');
  return name ? { name, address: bare } : { address: bare };
}

/** A phrase's words as a display name: one space between words, encoded
    words decoded — and two encoded words only whitespace separates joined
    with none (RFC 2047 §6.2). */
function phrase(words: readonly string[]): string {
  return decodeEncodedWords(words.join(' ')).trim();
}

function closing(text: string, from: number, quote: string): number {
  for (let i = from + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === quote) return i;
  }
  return -1;
}

function closingComment(text: string, from: number): number {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

const unescape = (text: string) => text.replace(/\\([\s\S])/g, '$1');

// ── format ───────────────────────────────────────────────────────────────

/** The header form of a mailbox — the name quoted (and escaped) when it has
    to be. UTF-8 stays as it is (RFC 6532); a mailer encodes for the wire. */
export function formatMailbox(mailbox: Mailbox): string {
  const name = mailbox.name?.trim();
  if (!name) return mailbox.address;
  const quoted = SPECIALS.test(name) || /\s{2}/.test(name) ? `"${name.replace(/["\\]/g, '\\$&')}"` : name;
  return `${quoted} <${mailbox.address}>`;
}

// ── split ────────────────────────────────────────────────────────────────

/** What separates the mailboxes of a typed run. */
const SEPARATORS = ',;\n\r';

/**
 * Splits a typed, pasted or header run into mailboxes — see the leniencies
 * above. A well-formed mailbox comes back in its canonical header form
 * (`<a@x.io>` → `a@x.io`, `Dr. Ada <a@x.io>` → `"Dr. Ada" <a@x.io>`, a
 * comment or an encoded word turned into the name); anything else comes back
 * as typed, for the user to fix. Empty tokens are dropped; duplicates are
 * the caller's.
 */
export function splitAddresses(raw: string): string[] {
  const tokens: string[] = [];
  const state = fresh();
  let current = '';
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (step(state, char)) {
      current += char;
      continue;
    }
    if (SEPARATORS.includes(char)) {
      tokens.push(current);
      current = '';
      continue;
    }
    // A group's colon: what came before it is the group's name, not a
    // mailbox — dropped; its members follow, up to the `;`.
    if (char === ':' && !/[@<]/.test(current) && /^(?:[\s,;]|$)/.test(raw.slice(i + 1, i + 2))) {
      current = '';
      continue;
    }
    current += char;
  }
  tokens.push(current);
  return tokens
    .map((token) => token.trim())
    .filter(Boolean)
    .flatMap((token) => (/[<"(]/.test(token) ? [token] : bareRun(token)))
    .map(canonical);
}

/** A bare run's mailboxes: each run of words names the address after it. */
function bareRun(token: string): string[] {
  const mailboxes: string[] = [];
  let name: string[] = [];
  for (const word of token.split(/\s+/)) {
    if (!isEmailAddress(word)) {
      name.push(word);
      continue;
    }
    mailboxes.push(formatMailbox({ name: name.join(' ') || undefined, address: word }));
    name = [];
  }
  if (name.length) mailboxes.push(name.join(' '));
  return mailboxes;
}

/** A well-formed mailbox in its canonical header form; anything else as it is. */
function canonical(token: string): string {
  const mailbox = parseMailbox(token);
  return isEmailAddress(mailbox.address) ? formatMailbox(mailbox) : token;
}

// ── identity ─────────────────────────────────────────────────────────────

/**
 * What makes two entries one recipient. The domain is case-insensitive and
 * compared in its ASCII form (`müller.de` is `xn--mller-kva.de`); the local
 * part is lowercased too — RFC 5321 lets a server tell `Ada` from `ada`, no
 * real one does, and one recipient twice is the mistake that matters. Both
 * NFC-normalized, so a composed and a decomposed `ü` are one.
 */
export function addressIdentity(address: string): string {
  const at = address.lastIndexOf('@');
  if (at < 0) return address.trim().normalize('NFC').toLowerCase();
  const local = address.slice(0, at).normalize('NFC').toLowerCase();
  return `${local}@${asciiDomain(address.slice(at + 1).normalize('NFC').toLowerCase())}`;
}

function asciiDomain(domain: string): string {
  if (domain.startsWith('[') || /^[\x00-\x7F]*$/.test(domain)) return domain;
  try {
    return new URL(`http://${domain}/`).hostname;
  } catch {
    return domain;
  }
}

// ── RFC 2047 ─────────────────────────────────────────────────────────────

const ENCODED_WORD = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

/** Decodes the RFC 2047 encoded words in a header text; one that cannot be
    decoded stays as it is. Two encoded words only whitespace separates are
    joined with none. */
export function decodeEncodedWords(text: string): string {
  return text
    .replace(/(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)/g, '$1')
    .replace(ENCODED_WORD, (word, charset: string, encoding: string, data: string) => {
      try {
        const bytes =
          encoding.toUpperCase() === 'B'
            ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
            : quotedPrintable(data);
        // RFC 2231 lets a charset carry a language: `UTF-8*de`.
        return new TextDecoder(charset.split('*')[0], { fatal: true }).decode(bytes);
      } catch {
        return word;
      }
    });
}

function quotedPrintable(data: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const char = data[i];
    if (char === '_') bytes.push(0x20);
    else if (char === '=' && /^[0-9A-Fa-f]{2}$/.test(data.slice(i + 1, i + 3))) {
      bytes.push(parseInt(data.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(...new TextEncoder().encode(char));
  }
  return Uint8Array.from(bytes);
}

/** Our rule, as the contract every part of the library asks through. */
export const defaultAddressRules: AddressRules = {
  split: splitAddresses,
  parse: parseMailbox,
  format: formatMailbox,
  isValid: isEmailAddress,
  identity: addressIdentity,
};
