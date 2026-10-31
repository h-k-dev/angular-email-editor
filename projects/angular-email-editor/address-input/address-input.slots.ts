import { Directive, TemplateRef, inject, input } from '@angular/core';

/** When the label slot shows (`emailAddressLabel`). */
export type AddressLabelVisibility = 'always' | 'focused';

/**
 * The address input's label slot — opt in. By default the control owns no
 * label: the template that holds the form draws the row and the label beside
 * it, as it does for a plain `<input>`. A host that wants the label *inside*
 * the control — at the start of the chips, the chips wrapping under it, the
 * whole control one box (a Material form field around it, as iusta core
 * writes its rows) — hands the control a template:
 *
 *     <div email-address-input [formField]="envelope.to">
 *       <ng-template emailAddressLabel>To</ng-template>
 *     </div>
 *
 * The control renders it first in its row, in a box of its own
 * (`[data-slot=label]`), and names its text input by it — unless the host
 * named the input itself (`aria-labelledby` / `aria-label`).
 *
 * Shown `always`, by default, or only while focus is in the control
 * (`emailAddressLabel="focused"`) — Gmail's To: at rest the row is its
 * addresses alone, flush with where the label stood. Hidden, the box leaves
 * the flow the way a screen-reader-only label does, and still names the
 * input.
 */
@Directive({ selector: 'ng-template[emailAddressLabel]' })
export class AddressInputLabel {
  readonly template = inject(TemplateRef);

  /** When the label shows: `always`, or only while the control is focused. */
  readonly visible = input<AddressLabelVisibility, AddressLabelVisibility | ''>('always', {
    alias: 'emailAddressLabel',
    // The bare attribute (`<ng-template emailAddressLabel>`) is `always`.
    transform: (value) => value || 'always',
  });
}
