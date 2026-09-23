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
} from '@angular/core';
import { Editor, selectedImage, selectedImageAlt } from 'angular-email-editor';
import { editorState } from 'angular-email-editor/actions';

/**
 * Makes the host's own text field the alt text of the editor's selected
 * image — the image a click selected, or a drag over it alone
 * (`selectedImage`). Everything but the field and its words is done:
 *
 *     <input dir="auto" [emailImageAlt]="editor" #alt="emailImageAlt"
 *            (emailImageAltClosed)="open.set(false)" />
 *     <button (click)="alt.apply()">Apply</button>
 *
 * - the field shows the image's alt, and again whenever another image is
 *   selected; it is focused and selected as it appears, so typing replaces
 *   it (`[emailImageAltAutoSelect]="false"` for a field that is always
 *   there, a side panel's);
 * - Enter applies — trimmed, and an emptied field takes the alt off — and
 *   Escape puts the alt back as it was; both hand the caret back to the
 *   editor (`[emailImageAltFocus]="false"` keeps it) and say so through
 *   `emailImageAltClosed`: `true` applied, `false` not — the host's cue to
 *   close its popover. Neither fires mid-composition: an IME's own Enter
 *   and Escape stay the IME's;
 * - `apply()` and `cancel()` are there for the host's buttons, `value()`
 *   and `active()` for its bindings (an Apply that waits for a change).
 *
 * The field's words and direction are the host's: its label, its
 * placeholder, and `dir="auto"` so an alt in a right-to-left script reads
 * the right way round. The image stays selected throughout — the editor
 * keeps its selection while the field has focus — so the popover can sit
 * where the host likes.
 */
@Directive({
  selector: 'input[emailImageAlt], textarea[emailImageAlt]',
  exportAs: 'emailImageAlt',
  host: {
    '[value]': 'value()',
    '(input)': 'value.set($any($event.target).value)',
    '(keydown.enter)': 'onKey($event, true)',
    '(keydown.escape)': 'onKey($event, false)',
  },
})
export class ImageAlt {
  /** The editor whose selected image this field describes. */
  readonly editor = input.required<Editor | undefined>({ alias: 'emailImageAlt' });

  /** Whether the field takes focus, its text selected, as it appears. */
  readonly autoSelect = input(true, {
    alias: 'emailImageAltAutoSelect',
    transform: booleanAttribute,
  });

  /** Whether the caret returns to the editor after an apply or a cancel. */
  readonly returnFocus = input(true, { alias: 'emailImageAltFocus', transform: booleanAttribute });

  /** Done with the field: `true` when the alt was applied, `false` when
      not — cancelled, or no image to apply it to. */
  readonly closed = output<boolean>({ alias: 'emailImageAltClosed' });

  readonly #element = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef)
    .nativeElement;

  readonly #state = editorState(() => this.editor());

  /** The selected image — where it is and what its alt says — or null. */
  readonly #image = computed(
    () => {
      const state = this.#state();
      const image = state && selectedImage(state);
      return image ? { pos: image.pos, alt: selectedImageAlt(state) ?? '' } : null;
    },
    { equal: (a, b) => a?.pos === b?.pos && a?.alt === b?.alt },
  );

  /** Whether an image is selected at all — there is nothing to describe
      otherwise, and `apply()` does nothing. */
  readonly active = computed(() => this.#image() !== null);

  /**
   * What the field says: the selected image's alt, until typing changes it
   * — the draft. It starts over from the image whenever another one is
   * selected or its alt changes elsewhere; typing changes no editor state,
   * so it is never written over. Deliberately no write-back setter: the
   * draft reaches the document once, on `apply()`, as one undo step — not
   * a transaction per keystroke.
   */
  readonly value = linkedSignal(() => this.#image()?.alt ?? '');

  constructor() {
    // Focus is a DOM write, after the render that put the field (and its
    // bound value) on the page.
    afterNextRender({
      write: () => {
        if (!this.autoSelect()) return;
        this.#element.focus();
        this.#element.select();
      },
    });
  }

  /** Writes the draft to the selected image's alt. False when no image is
      selected. */
  apply(): boolean {
    const applied = !!this.editor()?.commands['setImageAlt']?.(this.value());
    this.#done(applied);
    return applied;
  }

  /** Leaves the alt as it was, and the field with it. */
  cancel(): void {
    this.value.set(this.#image()?.alt ?? '');
    this.#done(false);
  }

  protected onKey(event: Event, apply: boolean): void {
    if ((event as KeyboardEvent).isComposing) return;
    event.preventDefault();
    if (apply) this.apply();
    else this.cancel();
  }

  #done(applied: boolean): void {
    if (this.returnFocus()) this.editor()?.focus();
    this.closed.emit(applied);
  }
}
