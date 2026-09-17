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

/**
 * Splits a typed or pasted run into mailboxes. Commas, semicolons and line
 * breaks separate — except inside quotes or angle brackets, so
 * `"Lovelace, Ada" <ada@example.com>, grace@example.com` is two. A run of
 * bare addresses that only whitespace separates (a copied column, a
 * space-separated list) splits on that too; a token with a display name
 * keeps its spaces. Empty tokens are dropped; duplicates are the caller's.
 */
export function splitAddresses(raw: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quoted = false;
  let angled = false;
  for (const char of raw) {
    if (char === '"' && !angled) quoted = !quoted;
    else if (char === '<' && !quoted) angled = true;
    else if (char === '>' && !quoted) angled = false;
    if (!quoted && !angled && (char === ',' || char === ';' || char === '\n' || char === '\r')) {
      tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  tokens.push(current);
  return tokens.flatMap((token) => {
    const trimmed = token.trim();
    if (!trimmed) return [];
    // A bare run — no name, no brackets — may be several addresses that only
    // whitespace separates.
    return /[<"]/.test(trimmed) ? [trimmed] : trimmed.split(/\s+/);
  });
}
