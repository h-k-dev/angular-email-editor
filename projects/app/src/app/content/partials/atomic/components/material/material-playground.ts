import { Component, computed, inject, signal } from '@angular/core';
import { FormField, disabled, form, required } from '@angular/forms/signals';
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { AddressInput, addressList } from '@h-k-dev/angular-email-editor/address-input';
import { AddressFormField } from '@h-k-dev/angular-email-editor/material';

import { Playground, PlaygroundSubject, knob } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/**
 * The address input as a Material form field's control — the one entry
 * point that imports Material. The knobs are the field's own (appearance,
 * the label's float, the subscript's room) and the form's rules; the
 * value panel is what the field reads off the input.
 */
@Component({
  selector: 'material-playground',
  imports: [
    PlaygroundFrame,
    PlaygroundSubject,
    AddressInput,
    AddressFormField,
    FormField,
    MatFormField,
    MatLabel,
    MatHint,
    MatError,
  ],
  templateUrl: './material-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './material-playground.scss'],
  providers: [Playground],
})
export class MaterialPlayground {
  protected readonly playground = inject(Playground);

  readonly appearance = signal<'fill' | 'outline'>('fill');
  readonly floatLabel = signal<'auto' | 'always'>('auto');
  readonly subscriptSizing = signal<'fixed' | 'dynamic'>('fixed');
  readonly label = signal('To');
  readonly hint = signal('Separate addresses with a comma');
  readonly isRequired = signal(true);
  readonly isDisabled = signal(false);

  protected readonly recipients = signal({ to: [] as string[] });
  protected readonly fields = form(this.recipients, (p) => {
    addressList(p.to, { min: 0 });
    required(p.to, { when: () => this.isRequired() });
    disabled(p.to, () => this.isDisabled());
  });

  protected readonly knobs = [
    knob.choice('appearance', this.appearance, ['fill', 'outline']),
    knob.choice('floatLabel', this.floatLabel, ['auto', 'always']),
    knob.choice('subscriptSizing', this.subscriptSizing, ['fixed', 'dynamic']),
    knob.text('mat-label', this.label),
    knob.text('mat-hint', this.hint),
    knob.boolean('required (form)', this.isRequired),
    knob.boolean('disabled (form)', this.isDisabled),
  ];

  protected readonly state = computed(() => {
    const field = this.fields.to();
    return {
      value: field.value(),
      required: field.required(),
      touched: field.touched(),
      errors: field.errors().map(({ kind, message }) => ({ kind, message })),
    };
  });
}
