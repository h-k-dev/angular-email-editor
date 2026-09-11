import {
  type PathKind,
  type SchemaPath,
  type SchemaPathRules,
  type ValidationError,
  validate,
} from '@angular/forms/signals';
import { isMailbox } from '../address-chip/address';

/** The error kinds `addressList` reports, for a host that switches on them. */
export const ADDRESS_LIST_EMPTY = 'addressList.empty';
export const ADDRESS_LIST_INVALID = 'addressList.invalid';
export const ADDRESS_LIST_TOO_MANY = 'addressList.tooMany';

export interface AddressListOptions {
  /** Fewest addresses the list must hold. 1 by default; 0 for Cc and Bcc. */
  readonly min?: number;
  /** Most addresses the list may hold. Unbounded by default; 1 for From. */
  readonly max?: number;
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
 * the offenders named in the message so a chip can be found and fixed.
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
  const { min = 1, max = Infinity } = options;
  const messages = { ...MESSAGES, ...options.messages };
  validate(path, ({ value }) => {
    const addresses = value();
    const errors: ValidationError[] = [];
    if (addresses.length < min) {
      errors.push({ kind: ADDRESS_LIST_EMPTY, message: messages.empty(min) });
    }
    const offenders = addresses.filter((address) => !isMailbox(address));
    if (offenders.length) {
      errors.push({ kind: ADDRESS_LIST_INVALID, message: messages.invalid(offenders) });
    }
    if (addresses.length > max) {
      errors.push({ kind: ADDRESS_LIST_TOO_MANY, message: messages.tooMany(max) });
    }
    return errors.length ? errors : null;
  });
}
