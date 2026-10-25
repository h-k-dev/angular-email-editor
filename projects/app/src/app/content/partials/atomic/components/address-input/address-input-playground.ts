import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormField, disabled, form, readonly } from '@angular/forms/signals';
import {
  AddressDragGroup,
  AddressInput,
  AddressInputLabel,
  addressList,
} from '@h-k-dev/angular-email-editor/address-input';

import { Playground, PlaygroundAction, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** A valid mailbox, a typo and a placeholder: the three things a chip can be. */
const START = ['Ada Lovelace <ada@example.com>', 'grace@example', '{{contact.email}}'];

/**
 * The address input as a composer has it: To and Cc, each a signal-forms
 * field under `addressList`, side by side in one drag group so a chip can
 * be dragged between them. The knobs are the inputs and the form's own
 * rules (`disabled`, `readonly`); the value panel is the To field's state.
 */
@Component({
  selector: 'address-input-playground',
  imports: [
    PlaygroundFrame,
    PlaygroundSubject,
    AddressInput,
    AddressInputLabel,
    AddressDragGroup,
    FormField,
  ],
  templateUrl: './address-input-playground.html',
  styleUrl: '../playground/playground-stage.scss',
  providers: [Playground],
})
export class AddressInputPlayground {
  protected readonly playground = inject(Playground);

  readonly placeholder = signal('Recipients');
  readonly limit = signal(0);
  readonly allowDrag = signal(true);
  readonly isDisabled = signal(false);
  readonly isReadonly = signal(false);
  readonly labelSlot = signal(false);

  protected readonly envelope = signal({ to: [...START], cc: [] as string[] });
  protected readonly fields = form(this.envelope, (p) => {
    addressList(p.to);
    addressList(p.cc, { min: 0 });
    disabled(p.to, () => this.isDisabled());
    disabled(p.cc, () => this.isDisabled());
    readonly(p.to, () => this.isReadonly());
    readonly(p.cc, () => this.isReadonly());
  });

  /** 0 is "no limit", as a knob can say it. */
  protected readonly cap = computed(() => this.limit() || Infinity);

  protected readonly to = viewChild.required<AddressInput>('to');

  protected readonly knobs = [
    knob.text('placeholder', this.placeholder),
    knob.number('limit', this.limit, { min: 0, max: 10 }),
    knob.boolean('allowDrag', this.allowDrag),
    knob.boolean('disabled (form)', this.isDisabled),
    knob.boolean('readonly (form)', this.isReadonly),
    knob.boolean('emailAddressLabel slot', this.labelSlot),
  ];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 'focus()', run: () => this.to().focus() },
    { name: "commit('bob@example.com')", run: () => this.to().commit('bob@example.com') },
    { name: "select('Ada…')", run: () => this.to().select(START[0]) },
    { name: 'reset value', run: () => this.envelope.set({ to: [...START], cc: [] }) },
  ];

  /** The To field as the form sees it. */
  protected readonly state = computed(() => {
    const field = this.fields.to();
    return {
      value: field.value(),
      valid: field.valid(),
      touched: field.touched(),
      dirty: field.dirty(),
      errors: field.errors().map(({ kind, message }) => ({ kind, message })),
    };
  });
}
