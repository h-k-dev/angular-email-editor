import {
  Directive,
  ElementRef,
  afterNextRender,
  booleanAttribute,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { selectedImage, selectedImageSource } from '@h-k-dev/angular-email-editor';
import {
  type BoundEditor,
  editorState,
  resolveEditor,
} from '@h-k-dev/angular-email-editor/actions';

/**
 * Makes the host's own text field the link of the editor's selected image —
 * the address a placeholder is filled from, or a picture's swapped for. The
 * twin of `[emailImageAlt]`, and written the same way:
 *
 *     <input type="url" [emailImageSource]="editor" #link="emailImageSource"
 *            [attr.aria-invalid]="link.refused()"
 *            (emailImageSourceClosed)="open.set(false)" />
 *     <button (click)="link.apply()">Apply</button>
 *
 * - the field shows the image's address — empty for a placeholder and for
 *   an embedded picture (its `cid:` or data URL is nothing to type over) —
 *   and again whenever another image is selected; it is focused and
 *   selected as it appears (`[emailImageSourceAutoSelect]="false"` for a
 *   field that is always there);
 * - Enter applies (`setImageSource`): a placeholder is filled, its frame
 *   kept; a picture takes the new address, its width and alt kept. Escape
 *   puts the field back. Both hand the caret back to the editor
 *   (`[emailImageSourceFocus]="false"` keeps it) and say so through
 *   `emailImageSourceClosed`: `true` applied, `false` not;
 * - an address the host's rules turn away (`createImageSources({ accept
 *   })`) is not set and the field stays open, `refused()` true until the
 *   next keystroke — the host's cue to say why (its `onRefused` hears the
 *   address too). An empty field applies nothing and closes;
 * - `apply()` and `cancel()` for the host's buttons; `value()`, `active()`
 *   and `refused()` for its bindings.
 *
 * The editor is bound — or, the attribute bare, the island's
 * (`EMAIL_EDITOR`), as `[emailImageAlt]`'s.
 */
@Directive({
  selector: 'input[emailImageSource], textarea[emailImageSource]',
  exportAs: 'emailImageSource',
  host: {
    '[value]': 'value()',
    '(input)': 'onInput($any($event.target).value)',
    '(keydown.enter)': 'onKey($event, true)',
    '(keydown.escape)': 'onKey($event, false)',
  },
})
export class ImageSource {
  /** The editor whose selected image this field links. Bare, the island's
      (`EMAIL_EDITOR`). */
  readonly editor = input.required<BoundEditor>({ alias: 'emailImageSource' });

  /** The editor in use: the bound one, else the island's. */
  readonly #editor = resolveEditor(this.editor, 'emailImageSource');

  /** Whether the field takes focus, its text selected, as it appears. */
  readonly autoSelect = input(true, {
    alias: 'emailImageSourceAutoSelect',
    transform: booleanAttribute,
  });

  /** Whether the caret returns to the editor after an apply or a cancel. */
  readonly returnFocus = input(true, {
    alias: 'emailImageSourceFocus',
    transform: booleanAttribute,
  });

  /** Done with the field: `true` when the address was set, `false` when
      not — cancelled, emptied, or no image to set it on. A refused address
      does not close it. */
  readonly closed = output<boolean>({ alias: 'emailImageSourceClosed' });

  readonly #element =
    inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef).nativeElement;

  readonly #state = editorState(this.#editor);

  /** The selected image — where it is and its address — or null. */
  readonly #image = computed(
    () => {
      const state = this.#state();
      const image = state && selectedImage(state);
      return image ? { pos: image.pos, src: selectedImageSource(state) ?? '' } : null;
    },
    { equal: (a, b) => a?.pos === b?.pos && a?.src === b?.src },
  );

  /** Whether an image is selected at all — `apply()` does nothing
      otherwise. */
  readonly active = computed(() => this.#image() !== null);

  /** What the field says: the selected image's address, until typing
      changes it. Starts over whenever another image is selected or its
      source changes elsewhere; the document hears it once, on `apply()`. */
  readonly value = linkedSignal(() => this.#image()?.src ?? '');

  readonly #refused = signal(false);

  /** The last `apply()` was turned away by the host's rules — until the
      field changes. */
  readonly refused = this.#refused.asReadonly();

  constructor() {
    afterNextRender({
      write: () => {
        if (!this.autoSelect()) return;
        this.#element.focus();
        this.#element.select();
      },
    });
  }

  /** Gives the selected image the address in the field. False when there is
      no image, the field is empty, or the rules refuse it — the field then
      stays, `refused()` true. */
  apply(): boolean {
    const value = this.value().trim();
    if (!value || !this.active()) {
      this.#done(false);
      return false;
    }
    const applied = !!this.#editor()?.commands['setImageSource']?.(value);
    if (!applied) {
      this.#refused.set(true);
      return false;
    }
    this.#done(true);
    return true;
  }

  /** Leaves the image as it was, and the field with it. */
  cancel(): void {
    this.value.set(this.#image()?.src ?? '');
    this.#refused.set(false);
    this.#done(false);
  }

  protected onInput(value: string): void {
    this.value.set(value);
    this.#refused.set(false);
  }

  protected onKey(event: Event, apply: boolean): void {
    if ((event as KeyboardEvent).isComposing) return;
    event.preventDefault();
    if (apply) this.apply();
    else this.cancel();
  }

  #done(applied: boolean): void {
    if (this.returnFocus()) this.#editor()?.focus();
    this.closed.emit(applied);
  }
}
