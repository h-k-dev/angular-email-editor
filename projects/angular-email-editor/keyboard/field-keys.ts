import { Directive, ElementRef, inject, output, untracked } from '@angular/core';
import { FormField } from '@angular/forms/signals';

/**
 * The keys of a field that sits inside something with keys of its own — a
 * number field in a menu, a panel, a toolbar:
 *
 * - What is typed stays in the field: no key reaches the menu round it, so
 *   a digit is never the menu's typeahead and an arrow steps the number,
 *   not the menu's rows. Shortcuts with Ctrl or ⌘ still go up — they are
 *   the page's.
 * - Enter commits: the field's value goes to its model now, and
 *   `emailFieldKeysCommitted` fires — a menu closes on it.
 * - Escape puts the field back as its model says, and
 *   `emailFieldKeysDismissed` fires — a menu closes on it, the caret back
 *   in the text.
 *
 * With signal forms (`[formField]` on the same element) it is the field's
 * other half: a field debounced to its blur (`debounce(path, 'blur')`) —
 * one write when the user is done, not one per key — commits on Enter and
 * on the native `change` (a spinner's step, an arrow key) as well, and
 * after every commit shows what its model took. That matters where the
 * model snaps or refuses (an `editorModel`, `/actions`): 9 typed where the
 * grid is 4 and the document already says 8 is no change to the model, so
 * nothing would redraw the 9.
 *
 *     <input type="number" [formField]="fields.block" emailFieldKeys
 *            (emailFieldKeysCommitted)="close()" (emailFieldKeysDismissed)="close()" />
 *
 * Without `[formField]` it only keeps the keys and says Enter and Escape.
 * Behaviour only: it renders nothing and sets no attribute.
 */
@Directive({
  selector: '[emailFieldKeys]',
  host: {
    '(keydown)': 'onKeydown($event)',
    '(change)': 'commit()',
  },
})
export class FieldKeys {
  /** Enter: the value is in. */
  readonly committed = output<void>({ alias: 'emailFieldKeysCommitted' });

  /** Escape: the field is back as it was. */
  readonly dismissed = output<void>({ alias: 'emailFieldKeysDismissed' });

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #formField = inject(FormField, { self: true, optional: true });

  protected onKeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey && !event.metaKey) event.stopPropagation();
    if (event.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.commit();
      this.committed.emit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.#show();
      this.dismissed.emit();
    }
  }

  /** Hands what the field holds to its model now, and shows what the model
      took. */
  commit(): void {
    const field = this.#formField?.state();
    if (!field) return;
    // Touching a field ends its debounce: the value goes to the model.
    untracked(() => field.markAsTouched({ skipDescendants: true }));
    this.#show();
  }

  /** The field as its model says — the control's buffer and the element. */
  #show(): void {
    const field = this.#formField?.state();
    if (!field) return;
    untracked(() => {
      const value = field.value();
      field.controlValue.set(value);
      // The binding writes only a value unlike the one it wrote last: a
      // model that took nothing new leaves the typed text standing.
      const host = this.#host;
      if (host instanceof HTMLInputElement || host instanceof HTMLTextAreaElement) {
        const text = value == null ? '' : String(value);
        if (host.value !== text) host.value = text;
      }
    });
  }
}
