import { Directive, TemplateRef, inject } from '@angular/core';
import { Mailbox } from './address';

/**
 * The chip's template slot. A host that wants its own remove control — a
 * Material icon button, a text link, a different glyph — hands the chip a
 * template, and the chip renders it in the box at its end where the default
 * button sits. The template gets everything the default button uses, so it
 * can be just as accessible.
 *
 *     <div email-address-input [formField]="envelope.to">
 *       <button
 *         *emailAddressChipRemove="let remove = remove; let label = label; let disabled = disabled"
 *         type="button"
 *         [attr.aria-label]="label"
 *         [disabled]="disabled"
 *         (click)="remove()"
 *       >
 *         <mat-icon inline>close</mat-icon>
 *       </button>
 *     </div>
 *
 * On an address input it applies to every chip the input renders; on a chip
 * of the host's own it applies to that chip.
 */

/** What the remove template is given. */
export interface AddressChipRemoveContext {
  /** The mailbox in header form, as the chip holds it. */
  readonly $implicit: string;
  readonly mailbox: Mailbox;
  /** Whether the address is well-formed. */
  readonly valid: boolean;
  /** The remove control is out of play — the chip is `aria-disabled`. */
  readonly disabled: boolean;
  /** Whether the control belongs in the tab order. False in a list that
      reaches its chips with the arrow keys instead; give it tabindex -1. */
  readonly tabbable: boolean;
  /** The control's accessible name — "Remove ada@example.com". */
  readonly label: string;
  /** Asks the host to drop the address; does nothing while disabled. */
  readonly remove: () => void;
}

/**
 * The chip's remove slot: mark an `ng-template` with it (or use the `*`
 * shorthand on the element itself) and the chip renders it in place of the
 * default button, in its `trailing` box. Not rendered at all when the chip
 * is not `removable`.
 */
@Directive({ selector: 'ng-template[emailAddressChipRemove]' })
export class AddressChipRemove {
  readonly template = inject<TemplateRef<AddressChipRemoveContext>>(TemplateRef);

  static ngTemplateContextGuard(
    _directive: AddressChipRemove,
    context: unknown,
  ): context is AddressChipRemoveContext {
    return true;
  }
}
