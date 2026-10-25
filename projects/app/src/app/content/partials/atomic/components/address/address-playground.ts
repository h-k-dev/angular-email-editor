import { Component, computed, signal } from '@angular/core';
import {
  AddressRules,
  addressKey,
  defaultAddressRules,
  isMailbox,
  isPending,
  joinAddresses,
} from '@h-k-dev/angular-email-editor/address';

import { Playground, PlaygroundAction, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** A header with everything the rule has to get right. */
const HEADER =
  '"Lovelace, Ada" <ada@example.com>, grace@example, {{contact.email}}, ADA@Example.com (Ada at home), =?UTF-8?B?TcO8bGxlcg==?= <hans@example.de>';

/** What the rule makes of one entry. */
interface Entry {
  readonly raw: string;
  readonly name: string | null;
  readonly address: string;
  readonly mailbox: boolean;
  readonly pending: boolean;
  readonly key: string;
  readonly formatted: string | null;
  /** Another entry before it is the same recipient. */
  readonly duplicate: boolean;
}

/**
 * The address rule, as functions: a header in, every entry as the rule
 * reads it — split, parsed (name and address, encoded words decoded),
 * judged (a mailbox, a pending placeholder, or neither), keyed for
 * duplicates — and the list joined back into one header. The knobs swap
 * parts of the rule, as `provideAddressRules` would for a host.
 */
@Component({
  selector: 'address-playground',
  imports: [PlaygroundFrame],
  templateUrl: './address-playground.html',
  styleUrl: '../playground/playground-stage.scss',
  providers: [Playground],
})
export class AddressPlayground {
  readonly header = signal(HEADER);
  readonly placeholders = signal(true);
  readonly strict = signal(false);

  /** The rule in force: ours, with the knobs' parts over it. */
  protected readonly rules = computed<AddressRules>(() => ({
    ...defaultAddressRules,
    ...(this.placeholders() ? {} : { isPlaceholder: () => false }),
    // A host's stricter validator: ours, and nothing upper case.
    ...(this.strict()
      ? {
          isValid: (address: string) =>
            defaultAddressRules.isValid(address) && address === address.toLowerCase(),
        }
      : {}),
  }));

  protected readonly entries = computed<Entry[]>(() => {
    const rules = this.rules();
    const seen = new Set<string>();
    return rules.split(this.header()).map((raw) => {
      const mailbox = rules.parse(raw);
      const valid = isMailbox(raw, rules);
      const key = addressKey(raw, rules);
      const duplicate = seen.has(key);
      seen.add(key);
      return {
        raw,
        name: mailbox.name ?? null,
        address: mailbox.address,
        mailbox: valid,
        pending: isPending(raw, rules),
        key,
        formatted: valid ? rules.format(mailbox) : null,
        duplicate,
      };
    });
  });

  protected readonly joined = computed(() =>
    joinAddresses(
      this.entries().map((entry) => entry.raw),
      this.rules(),
    ),
  );

  protected readonly value = computed(() => ({
    split: this.entries().map((entry) => entry.raw),
    joined: this.joined(),
    roundTrips:
      JSON.stringify(this.rules().split(this.joined())) ===
      JSON.stringify(this.entries().map((entry) => entry.raw.trim())),
  }));

  protected readonly knobs = [
    knob.text('header', this.header),
    knob.boolean('isPlaceholder (ours)', this.placeholders),
    knob.boolean('isValid: lower case only', this.strict),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 'reset the header', run: () => this.header.set(HEADER) },
    { name: 'joined → header', run: () => this.header.set(this.joined()) },
  ];
}
