import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { AddressChip, AddressChipRemove } from '@h-k-dev/angular-email-editor/address-chip';

import { Playground, PlaygroundAction, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/**
 * Address chips of the host's own — a read-only header's, a sent copy's:
 * the chip under test (its address a knob) beside a typo and a
 * placeholder, every knob on all three. The chip asks and never does, so
 * `removed` is only logged here.
 */
@Component({
  selector: 'address-chip-playground',
  imports: [PlaygroundFrame, PlaygroundSubject, AddressChip, AddressChipRemove],
  templateUrl: './address-chip-playground.html',
  styleUrl: '../playground/playground-stage.scss',
  providers: [Playground],
})
export class AddressChipPlayground {
  protected readonly playground = inject(Playground);

  readonly address = signal('Ada Lovelace <ada@example.com>');
  readonly removable = signal(true);
  readonly inline = signal(false);
  readonly current = signal(false);
  readonly ariaDisabled = signal(false);
  readonly draggable = signal(false);
  readonly removeTabbable = signal(true);
  readonly holdDelay = signal(500);
  readonly removeSlot = signal(false);

  /** The chip under test first, then the other two kinds. */
  protected readonly chips = computed(() => [
    { label: 'Chip under test', address: this.address() },
    { label: 'A typo', address: 'grace@example' },
    { label: 'A placeholder', address: '{{contact.email}}' },
  ]);

  protected readonly chip = viewChild.required(AddressChip);

  protected readonly knobs = [
    knob.text('address', this.address),
    knob.boolean('removable', this.removable),
    knob.boolean('inline', this.inline),
    knob.boolean('aria-current', this.current),
    knob.boolean('aria-disabled', this.ariaDisabled),
    knob.boolean('draggable', this.draggable),
    knob.boolean('removeTabbable', this.removeTabbable),
    knob.number('holdDelay', this.holdDelay, { min: 0, step: 100 }),
    knob.boolean('emailAddressChipRemove slot', this.removeSlot),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 'showCopied()', run: () => this.chip().showCopied() },
    { name: "announce('Moved')", run: () => this.chip().announce('Moved') },
  ];
}
