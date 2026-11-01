import { Component, input, model } from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';

/**
 * A switch, Notion's: a small rounded track and a knob, off a grey of the
 * ink, on the theme's primary. A button with `role="switch"` — Space and
 * Enter turn it, its state is `aria-checked` — so a `<label>` round it (or
 * pointing at it) turns it from its words too:
 *
 *     <label class="row"><button toggleSwitch [formField]="form.allDay"></button> All day</label>
 *     <button toggleSwitch [(value)]="on" aria-label="Wrap lines"></button>
 *
 * **A signal-forms control**: a `FormValueControl<boolean>`, so
 * `[formField]` binds it — its value, and its disabled state — with no
 * adapter; `[(value)]` without a form. Sized by `--toggle-switch-width`,
 * `-height` and `-inset` (the knob is the height less the inset each side).
 */
@Component({
  selector: 'button[toggleSwitch]',
  template: '<span class="toggle-switch__knob" aria-hidden="true"></span>',
  styleUrl: './toggle-switch.scss',
  host: {
    class: 'toggle-switch',
    type: 'button',
    role: 'switch',
    '[attr.aria-checked]': 'value()',
    '[disabled]': 'disabled()',
    '(click)': 'toggle()',
  },
})
export class ToggleSwitch implements FormValueControl<boolean> {
  /** On or off — the form's field, or a two-way binding. */
  readonly value = model(false);
  readonly disabled = input(false);

  protected toggle(): void {
    this.value.update((on) => !on);
  }
}
