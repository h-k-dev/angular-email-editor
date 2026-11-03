import { inject } from '@angular/core';
import {
  type PathKind,
  type SchemaPath,
  type SchemaPathRules,
  type ValidationError,
  validate,
} from '@angular/forms/signals';
import {
  ADDRESS_RULES,
  AddressRules,
  defaultAddressRules,
  isMailbox,
  isPending,
} from '@h-k-dev/angular-email-editor/address';

/** The error kinds `addressList` and `addressText` report, for a host that
    switches on them. */
export const ADDRESS_LIST_EMPTY = 'addressList.empty';
export const ADDRESS_LIST_INVALID = 'addressList.invalid';
export const ADDRESS_LIST_TOO_MANY = 'addressList.tooMany';

export interface AddressListOptions {
  /** Fewest addresses the list must hold. 1 by default; 0 for Cc and Bcc. */
  readonly min?: number;
  /** Most addresses the list may hold. Unbounded by default; 1 for From. */
  readonly max?: number;
  /** The address rule to judge by. By default the one in force where the
      form is made (`provideAddressRules`), else ours. */
  readonly rules?: AddressRules;
  /** The messages, for a host that words them itself or translates them. */
  readonly messages?: {
    readonly empty?: (min: number) => string;
    readonly invalid?: (offenders: readonly string[]) => string;
    readonly tooMany?: (max: number) => string;
  };
}

const MESSAGES: Required<NonNullable<AddressListOptions['messages']>> = {
  empty: (min) => (min === 1 ? 'Add at least one address' : `Add at least ${min} addresses`),
  invalid: (offenders) => {
    const [first, ...rest] = offenders;
    if (!rest.length) return `“${first}” is not an email address`;
    return `“${first}” and ${rest.length} other${rest.length === 1 ? '' : 's'} are not email addresses`;
  },
  tooMany: (max) => (max === 1 ? 'Only one address here' : `At most ${max} addresses`),
};

/**
 * The rule an address field needs and the built-ins cannot give it:
 * `required` takes an empty array for a value, and `email` validates one
 * string. This validates a `string[]` of mailboxes in header form — the
 * address input's value — as a list: at least `min` of them (one, unless
 * told otherwise), at most `max`, and every one a well-formed address, with
 * the offenders named in the message so a chip can be found and fixed. A
 * placeholder a template fills in later (`{{contact.email}}`, by the rule's
 * `isPlaceholder`) is no offender — it counts toward `min` and `max`;
 * whether it may still be sent unresolved is the host's call.
 *
 * ```ts
 * const envelope = form(model, (p) => {
 *   addressList(p.from, { max: 1 });
 *   addressList(p.to);
 *   addressList(p.cc, { min: 0 });
 * });
 * ```
 *
 * Errors carry a `kind` from the `ADDRESS_LIST_*` constants and a `message`
 * the input shows; pass `messages` to word or translate them.
 */
export function addressList<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string[], SchemaPathRules.Supported, TPathKind>,
  options: AddressListOptions = {},
): void {
  const judge = listJudge({ ...options, min: options.min ?? 1 });
  validate(path, ({ value }) => judge(value()));
}

/**
 * `addressList` for a field that keeps its addresses as ONE string — a plain
 * text input, or a contact's `email` the backend stores as text: `Ada
 * Lovelace <ada@x.io>`, or several, `Ada <ada@x.io>, bob@x.io`. The string
 * is split by the rule's own `split` (so `,` `;` and line breaks separate,
 * a comma inside a quoted name does not) and judged as the list.
 *
 * An empty string is an empty list, and `min` is 0 here unless told
 * otherwise — clearing an optional field stays a clear. `max: 1` makes it a
 * single-mailbox field that still takes a display name.
 *
 * ```ts
 * const contact = form(model, (p) => {
 *   addressText(p.email);
 *   addressText(p.replyTo, { max: 1 });
 * });
 * ```
 *
 * Same errors as `addressList`: the `ADDRESS_LIST_*` kinds, the offenders
 * named in the message.
 */
export function addressText<TPathKind extends PathKind = PathKind.Root>(
  path: SchemaPath<string, SchemaPathRules.Supported, TPathKind>,
  options: AddressListOptions = {},
): void {
  const rules = options.rules ?? rulesInForce();
  const judge = listJudge({ ...options, min: options.min ?? 0, rules });
  validate(path, ({ value }) => judge(rules.split(value() ?? '')));
}

/** The verdict both rules give a list, with their options settled once,
    where the schema runs. */
function listJudge(
  options: AddressListOptions & { readonly min: number },
): (addresses: readonly string[]) => ValidationError[] | null {
  const { min, max = Infinity } = options;
  const messages = { ...MESSAGES, ...options.messages };
  const rules = options.rules ?? rulesInForce();
  return (addresses) => {
    const errors: ValidationError[] = [];
    if (addresses.length < min) {
      errors.push({ kind: ADDRESS_LIST_EMPTY, message: messages.empty(min) });
    }
    const offenders = addresses.filter(
      (address) => !isMailbox(address, rules) && !isPending(address, rules),
    );
    if (offenders.length) {
      errors.push({ kind: ADDRESS_LIST_INVALID, message: messages.invalid(offenders) });
    }
    if (addresses.length > max) {
      errors.push({ kind: ADDRESS_LIST_TOO_MANY, message: messages.tooMany(max) });
    }
    return errors.length ? errors : null;
  };
}

/** The rule provided where the schema runs — the form's injection context,
    when it was made in one — or ours. */
function rulesInForce(): AddressRules {
  try {
    return inject(ADDRESS_RULES);
  } catch {
    return defaultAddressRules;
  }
}
