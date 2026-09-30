import { InjectionToken, Provider } from '@angular/core';
import { defaultAddressRules } from './rules';

/**
 * A mailbox the way a header spells it: an address, and the display name a
 * client shows in front of it — `Ada Lovelace <ada@example.com>`,
 * `"Lovelace, Ada" <ada@example.com>`, or the bare `ada@example.com`.
 *
 * The chips hold that header form as one string, so a host's `string[]`
 * carries names without a second type and goes into a `To:` header as it
 * is.
 */
export interface Mailbox {
  /** The display name, if the mailbox has one; quotes already removed. */
  readonly name?: string;
  readonly address: string;
}

/**
 * The address rule — what an address is, how a mailbox is read and written,
 * how typed text splits into mailboxes. The library's own is `rules.ts`
 * ({@link defaultAddressRules}); a host with a rule of its own — a stricter
 * validator, an established parser, the rule its backend already enforces —
 * provides it with {@link provideAddressRules}, whole or in part, and every
 * address piece asks it instead: the input, the chip, the `addressList`
 * form rule, and (passed as an option) `replyEnvelope` and
 * `toInboundMessage`.
 */
export interface AddressRules {
  /** A typed, pasted or header run as mailboxes in header form. */
  split(raw: string): string[];
  /** A header-form mailbox as its name and address. */
  parse(raw: string): Mailbox;
  /** A mailbox in header form, the name quoted where it has to be. */
  format(mailbox: Mailbox): string;
  /** Whether a bare address — no name, no brackets — is well-formed. */
  isValid(address: string): boolean;
  /** What makes two addresses one recipient: equal identities are. */
  identity(address: string): string;
}

/** The address rule in force — ours unless a host provides its own. */
export const ADDRESS_RULES = new InjectionToken<AddressRules>('ADDRESS_RULES', {
  providedIn: 'root',
  factory: () => defaultAddressRules,
});

/**
 * Puts a host's address rule in force: the parts given replace ours, the
 * rest stay ours. Keeping an existing validator is one line:
 *
 * ```ts
 * providers: [provideAddressRules({ isValid: isValidEmail })]
 * ```
 */
export function provideAddressRules(rules: Partial<AddressRules>): Provider {
  return { provide: ADDRESS_RULES, useValue: { ...defaultAddressRules, ...rules } };
}

/** Whether a header-form string is a mailbox whose address is well-formed. */
export function isMailbox(raw: string, rules: AddressRules = defaultAddressRules): boolean {
  return rules.isValid(rules.parse(raw).address);
}

/** What makes two header-form entries one recipient — the name in front of
    the address makes no second one. For a list that holds each recipient
    once. */
export function addressKey(raw: string, rules: AddressRules = defaultAddressRules): string {
  return rules.identity(rules.parse(raw).address);
}
