import { Component, computed, inject, viewChild } from '@angular/core';
import { FormField, debounce, form, max, min } from '@angular/forms/signals';
import {
  SECTION_PADDING_MAX,
  emailExtensions,
  sectionPaddingOf,
} from '@h-k-dev/angular-email-editor';
import { editorState, sectionPaddingModel } from '@h-k-dev/angular-email-editor/actions';
import { EmailEditor } from '@h-k-dev/angular-email-editor/editor';
import { FieldKeys } from '@h-k-dev/angular-email-editor/keyboard';
import { TextSelection } from 'prosemirror-state';

import { Playground, PlaygroundAction } from '../playground/playground';
import { PlaygroundFrame } from '../playground/playground-frame';

/** A band with its caret's words in it, and a line outside it. */
const CONTENT =
  '<table class="aee-layout-section" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr>' +
  '<td bgcolor="#f1f3f4" style="padding: 20px 0px; background-color: rgb(241, 243, 244); color: rgb(32, 33, 36);">' +
  '<div style="max-width: 600px; margin-left: auto; margin-right: auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box;">' +
  '<div>A band: put the caret here, then set its padding in the menu.</div></div>' +
  '</td></tr></tbody></table>' +
  '<div>A line outside any band — its padding reads as none.</div>';

/**
 * A band's padding the way the composer's band menu sets it: two number
 * fields in a menu of their own (here a group that logs every key that
 * reaches it), each on `sectionPaddingModel` through signal forms and
 * wearing `emailFieldKeys`. Type a digit: the menu hears nothing. Type 9
 * and press Enter: the band takes 8 (its 4px grid) and the field says so.
 * Escape puts a field back.
 */
@Component({
  selector: 'keyboard-playground',
  imports: [EmailEditor, PlaygroundFrame, FormField, FieldKeys],
  templateUrl: './keyboard-playground.html',
  styleUrls: ['../playground/playground-stage.scss', './keyboard-playground.scss'],
  providers: [Playground],
})
export class KeyboardPlayground {
  protected readonly playground = inject(Playground);

  protected readonly kit = emailExtensions;
  protected readonly content = CONTENT;
  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly stage = viewChild(EmailEditor);
  readonly #editor = computed(() => this.stage()?.editor());
  readonly #state = editorState(() => this.#editor());

  /** The caret's band, its room — each field written once it is done with. */
  protected readonly padding = form(sectionPaddingModel(() => this.#editor()), (room) => {
    for (const side of [room.top, room.bottom, room.inline]) {
      min(side, 0);
      max(side, SECTION_PADDING_MAX);
      debounce(side, 'blur');
    }
  });

  protected readonly state = computed(() => {
    const state = this.#state();
    return {
      inBand: !!state && sectionPaddingOf(state) !== null,
      model: this.padding().value(),
    };
  });

  protected readonly knobs = [];

  protected readonly actions: readonly PlaygroundAction[] = [
    { name: 'caret into the band', run: () => this.#caretIntoBand() },
  ];

  /** A key that got past a field to the menu. */
  protected heard(event: KeyboardEvent): void {
    this.playground.log('the menu heard', event.key);
  }

  #caretIntoBand(): void {
    const editor = this.#editor();
    if (!editor) return;
    editor.focus();
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isTextblock) at = pos + 1;
      return at < 0;
    });
    if (at < 0) return;
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)),
    );
  }
}
