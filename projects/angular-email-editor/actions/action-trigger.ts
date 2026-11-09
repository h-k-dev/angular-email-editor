import { Directive, booleanAttribute, computed, inject, input } from '@angular/core';
import { EMAIL_ACTIONS, EditorActions } from './actions';

/**
 * Makes the host's own control the trigger of an editor action: a click runs
 * it, and the control says what the action's state is.
 *
 *     <button mat-icon-button emailAction="bold" [emailActionFrom]="actions"
 *             #bold="emailAction" [disabled]="bold.disabled()">
 *       <mat-icon>format_bold</mat-icon>
 *     </button>
 *
 * The action is named by its id, and looked up in the list it is from
 * (`injectActions`) here, in a `computed`: a template binds values and reads
 * signals, it calls no lookup of its own.
 *
 * The list is bound — or, with nothing bound, the island's (`EMAIL_ACTIONS`):
 * an `[emailActions]` on the toolbar around it, the `[emailEditor]` it is
 * inside, or a component that provides one for its menus:
 *
 *     <div role="toolbar" [emailActions]="editor">
 *       <button emailAction="bold">B</button>
 *     </div>
 *
 * Behaviour only, and ARIA only where the host's widget has not spoken:
 * - `aria-pressed` for a toggle, and `aria-disabled` when it cannot run —
 *   both off with `[emailActionAria]="false"` for a widget that writes its own
 *   (a Material button toggle);
 * - never the native `disabled`, a class or a style: how disabled *looks* is
 *   the host's, bound from `disabled()` as above. A control that is only
 *   `aria-disabled` stays reachable by keyboard, which is what a toolbar wants;
 * - a click on a disabled trigger runs nothing.
 *
 * After running, the caret goes back to the editor the action ran on — a
 * no-op for a pointer press under `emailKeepFocus`, the way back for a key
 * press in a toolbar. `[emailActionFocus]="false"` leaves focus on the
 * control, as the ARIA toolbar pattern has it. A host's own action (a link
 * dialog, a picker) never has focus taken from what it opened.
 */
@Directive({
  selector: '[emailAction]',
  exportAs: 'emailAction',
  host: {
    '[attr.aria-pressed]': 'ariaPressed()',
    '[attr.aria-disabled]': 'ariaDisabled()',
    '(click)': 'run()',
  },
})
export class ActionTrigger {
  /** The id of the action to trigger. */
  readonly id = input.required<string>({ alias: 'emailAction' });

  /** The actions it is one of — what `injectActions` returned. Left out,
      the island's (`EMAIL_ACTIONS`). */
  readonly from = input<EditorActions | undefined>(undefined, { alias: 'emailActionFrom' });

  readonly #island = inject(EMAIL_ACTIONS, { optional: true });

  /** The list in use: its own, else the island's. Neither is a mistake, and
      said so. */
  readonly #actions = computed(() => {
    const actions = this.from() ?? this.#island;
    if (!actions) {
      throw new Error(
        `[emailAction]="${this.id()}" has no actions: bind a list ` +
          `([emailActionFrom]="actions"), or put [emailActions] on an ancestor.`,
      );
    }
    return actions;
  });

  /** The action itself. `undefined` (no editor yet, or a kit without it) is a
      trigger with nothing to do: disabled. */
  readonly action = computed(() => this.#actions().get(this.id()));

  /** Whether this directive writes `aria-pressed` and `aria-disabled`. */
  readonly aria = input(true, { alias: 'emailActionAria', transform: booleanAttribute });

  /** Whether the caret returns to the editor after the action ran. */
  readonly returnFocus = input(true, { alias: 'emailActionFocus', transform: booleanAttribute });

  /** On at the selection. */
  readonly pressed = computed(() => this.action()?.pressed() ?? false);

  /** Cannot run right now — or has no action at all. */
  readonly disabled = computed(() => this.action()?.disabled() ?? true);

  protected readonly ariaPressed = computed(() =>
    this.aria() && this.action()?.toggles ? this.pressed() : null,
  );

  protected readonly ariaDisabled = computed(() => (this.aria() && this.disabled() ? true : null));

  /** Runs the action, as a click does. False when it did not apply. */
  run(): boolean {
    const action = this.action();
    if (!action || this.disabled()) return false;
    const applied = action.run();
    // A host's own action opened something of the host's: focus is its now.
    if (this.returnFocus() && !action.external) action.focus();
    return applied;
  }
}
