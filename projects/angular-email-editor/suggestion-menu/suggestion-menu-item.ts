import { Component, computed, inject, input } from '@angular/core';
import { SuggestionItem } from 'angular-email-editor';
import { SuggestionMenu } from './suggestion-menu';

/**
 * One row of a suggestion menu: an option of its listbox, standing for one of
 * the state's items. The host fills the row; the row takes its id (the one
 * the editor's `aria-activedescendant` names), reflects the highlight as
 * `aria-selected` and `data-active` — which is what the menu keeps scrolled
 * into view — and applies its item on click: a group opens, a command runs.
 *
 * Never focusable, never a button: the caret stays in the editor, and the
 * extension keeps a press on the menu from taking it away.
 */
@Component({
  selector: '[email-suggestion-menu-item]',
  template: '<ng-content />',
  styleUrl: './suggestion-menu-item.scss',
  host: {
    role: 'option',
    '[attr.id]': 'id()',
    '[attr.aria-selected]': 'active()',
    '[attr.data-active]': 'active() || null',
    '[attr.data-group]': '!!item().children || null',
    '(click)': 'select()',
  },
})
export class SuggestionMenuItem {
  /** The item this row stands for — one of the menu state's `items`. */
  readonly item = input.required<SuggestionItem>();

  readonly #menu = inject(SuggestionMenu);

  readonly #index = computed(() => this.#menu.indexOf(this.item()));

  /** The keyboard highlight is on this row. */
  readonly active = computed(() => {
    const index = this.#index();
    return index >= 0 && index === this.#menu.activeIndex();
  });

  protected readonly id = computed(() => {
    const optionId = this.#menu.optionId();
    const index = this.#index();
    return optionId && index >= 0 ? optionId(index) : null;
  });

  protected select(): void {
    this.#menu.state()?.select(this.item());
  }
}
