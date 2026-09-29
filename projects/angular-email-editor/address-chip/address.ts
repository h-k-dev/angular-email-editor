/**
 * A mailbox the way a header spells it: an address, and the display name a
 * client shows in front of it — `Ada Lovelace <ada@example.com>`,
 * `"Lovelace, Ada" <ada@example.com>`, or the bare `ada@example.com`.
 *
 * The chips hold that header form as one string, so a host's `string[]`
 * carries names without a second type and goes into a `To:` header as it
 * is. These helpers take it apart (to draw a chip) and put it back (to
 * commit what was typed).
 */
export interface Mailbox {
  /** The display name, if the mailbox has one; quotes already removed. */
  readonly name?: string;
  readonly address: string;
}

/** Good enough to catch a typo, loose enough to accept a real address:
    something@something.tld, no spaces, none of the header's brackets or
    quotes. The mailer validates for real. */
const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** `name <address>`, the name optionally quoted. */
const ANGLE = /^\s*(?:"([^"]*)"|([^<"]*?))\s*<([^<>]*)>\s*$/;

/** Characters a display name must be quoted to carry: RFC 5322's specials. */
const SPECIALS = /[()<>[\]:;@\\,."]/;

/** Whether a bare address is well-formed (no display name, no brackets). */
export function isEmailAddress(address: string): boolean {
  return ADDRESS.test(address);
}

/** Splits a header-form string into name and address. Anything that is not
    `name <address>` is taken as a bare address, whitespace trimmed. */
export function parseMailbox(raw: string): Mailbox {
  const match = ANGLE.exec(raw);
  if (!match) return { address: raw.trim() };
  const name = (match[1] ?? match[2] ?? '').trim();
  const address = match[3].trim();
  return name ? { name, address } : { address };
}

/** The header form of a mailbox — the name quoted when it has to be. */
export function formatMailbox(mailbox: Mailbox): string {
  const { name, address } = mailbox;
  if (!name) return address;
  const quoted = SPECIALS.test(name) ? `"${name.replace(/["\\]/g, '\\$&')}"` : name;
  return `${quoted} <${address}>`;
}

/** Whether a header-form string is a mailbox whose address is well-formed. */
export function isMailbox(raw: string): boolean {
  return isEmailAddress(parseMailbox(raw).address);
}

/** What separates the mailboxes of a typed run. RFC 5322 knows only the
    comma; every client also takes a semicolon, and a pasted list arrives
    one per line. */
const SEPARATORS = ',;\n\r';

/**
 * Walks a run to `end`: the indices of the separators that separate — those
 * outside a quoted name (where `\"` does not close it) and outside angle
 * brackets — and whether the walk ended inside either.
 */
function scan(raw: string, end = raw.length): { separators: number[]; open: boolean } {
  const separators: number[] = [];
  let quoted = false;
  let escaped = false;
  let angled = false;
  for (let i = 0; i < Math.min(end, raw.length); i++) {
    const char = raw[i];
    if (escaped) escaped = false;
    else if (quoted) {
      if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"' && !angled) quoted = true;
    else if (char === '<') angled = true;
    else if (char === '>') angled = false;
    else if (!angled && SEPARATORS.includes(char)) separators.push(i);
  }
  return { separators, open: quoted || angled };
}

/** Whether a separator typed at `caret` would separate — false inside a
    quoted name or angle brackets, where a comma is part of the mailbox:
    `"Lovelace, Ada"`. */
export function separatesAt(raw: string, caret: number): boolean {
  return !scan(raw, caret).open;
}

/**
 * Splits a typed or pasted run into mailboxes. Commas, semicolons and line
 * breaks separate — except inside quotes or angle brackets, so
 * `"Lovelace, Ada" <ada@example.com>, grace@example.com` is two. Empty
 * tokens are dropped; duplicates are the caller's.
 *
 * A bare run — no brackets, no quotes — is read the way people type it: the
 * words in front of an address name it (`Ada Lovelace ada@example.com` is
 * `Ada Lovelace <ada@example.com>`, which the grammar has no production for
 * but every client accepts), addresses that only whitespace separates are
 * several (a copied column), and words naming no address stay one token —
 * one typo to fix, not one per word.
 */
export function splitAddresses(raw: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  for (const index of [...scan(raw).separators, raw.length]) {
    tokens.push(raw.slice(start, index).trim());
    start = index + 1;
  }
  return tokens.filter(Boolean).flatMap((token) => (/[<"]/.test(token) ? [token] : bareRun(token)));
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
