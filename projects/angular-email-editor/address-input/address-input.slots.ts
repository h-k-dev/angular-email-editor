import { Directive, TemplateRef, inject } from '@angular/core';

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
 */
@Directive({ selector: 'ng-template[emailAddressLabel]' })
export class AddressInputLabel {
  readonly template = inject(TemplateRef);
}
