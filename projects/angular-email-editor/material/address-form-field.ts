import { DestroyRef, Directive, effect, inject } from '@angular/core';
import { MatFormFieldControl } from '@angular/material/form-field';
import { Subject } from 'rxjs';
import { AddressInput } from 'angular-email-editor/address-input';

/**
 * Makes an address input the control of an Angular Material form field —
 * opt in per field, with the attribute:
 *
 * ```html
 * <mat-form-field>
 *   <mat-label>To</mat-label>
 *   <div email-address-input emailMatFormField [formField]="envelope.to"></div>
 *   <mat-hint>Separate addresses with a comma</mat-hint>
 *   <mat-error>{{ envelope.to().errors()[0]?.message }}</mat-error>
 * </mat-form-field>
 * ```
 *
 * The directive is its own object, provided as the field's
 * `MatFormFieldControl` — so the input's `value`, `disabled` and `required`
 * stay the signal-forms contract they are, and nothing of Material reaches
 * the input itself. What the field asks, it reads off the input:
 *
 * - **Label** — `for` the input's text field (`id`); it floats while the
 *   field is focused or not `empty`: no chips *and* nothing typed.
 * - **Errors** — `errorState` is invalid *and* touched: `mat-error` shows at
 *   the moment the input starts flagging itself, never before.
 * - **Hints and errors are read out** — their ids join the text field's
 *   `aria-describedby`, beside any the host set itself.
 * - **A click on the field** — anywhere in its box — puts the caret in.
 *
 * No `NgControl`: signal forms bind through `[formField]`, which the field
 * does not need to know.
 */
@Directive({
  selector: '[email-address-input][emailMatFormField]',
  providers: [{ provide: MatFormFieldControl, useExisting: AddressFormField }],
})
export class AddressFormField implements MatFormFieldControl<string[]> {
  readonly #input = inject(AddressInput);

  /** Tells the field to look again — whenever anything it reads moves. */
  readonly stateChanges = new Subject<void>();

  readonly controlType = 'email-address-input';
  readonly ngControl = null;

  constructor() {
    effect(() => {
      // Everything the field reads, tracked: a change of any is news.
      this.#input.value();
      this.#input.text();
      this.#input.focused();
      this.#input.placeholder();
      this.#input.required();
      this.#input.disabled();
      this.#input.invalid();
      this.#input.touched();
      this.stateChanges.next();
    });
    inject(DestroyRef).onDestroy(() => this.stateChanges.complete());
  }

  get value(): string[] {
    return this.#input.value();
  }

  set value(value: string[] | null) {
    this.#input.value.set(value ?? []);
  }

  get id(): string {
    return this.#input.id;
  }

  get placeholder(): string {
    return this.#input.placeholder();
  }

  get focused(): boolean {
    return this.#input.focused();
  }

  get empty(): boolean {
    return !this.#input.value().length && !this.#input.text();
  }

  get shouldLabelFloat(): boolean {
    return this.focused || !this.empty;
  }

  get required(): boolean {
    return this.#input.required();
  }

  get disabled(): boolean {
    return this.#input.disabled();
  }

  get errorState(): boolean {
    return this.#input.invalid() && this.#input.touched();
  }

  /** The host's own `aria-describedby`, which the field keeps in its list. */
  get userAriaDescribedBy(): string | undefined {
    return this.#input.ariaDescribedby() ?? undefined;
  }

  describedByIds: string[] = [];

  setDescribedByIds(ids: string[]): void {
    this.describedByIds = ids;
    this.#input.describe(ids);
  }

  onContainerClick(): void {
    this.#input.focus();
  }
}
