import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  effect,
  inject,
  input,
  model,
  output,
} from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import { baseKeymap, chainCommands } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { inputRules, undoInputRule } from 'prosemirror-inputrules';
import { keymap } from 'prosemirror-keymap';
import { EditorState, Plugin, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';

import {
  breakLine,
  isAddress,
  linesSlice,
  linkHref,
  markdownSlice,
  noteDoc,
  noteEmpty,
  noteKeys,
  noteMarkdown,
  noteRules,
  setLink,
  sliceMarkdown,
} from './note-schema';

/** The placeholder on the first line while the note holds nothing. */
function placeholder(words: () => string): Plugin {
  return new Plugin({
    props: {
      decorations: (state) =>
        noteEmpty(state.doc)
          ? DecorationSet.create(state.doc, [
              Decoration.node(0, state.doc.firstChild!.nodeSize, {
                class: 'note-editor__empty',
                'data-placeholder': words(),
              }),
            ])
          : null,
    },
  });
}

/** HTML a code editor puts beside its text (VS Code, a terminal): styled
    runs of the text itself — the text, Markdown, says what is meant. */
function fromCodeEditor(html: string): boolean {
  return /white-space:\s*pre/i.test(html) || /^\s*(<meta[^>]*>)?\s*<pre[\s>]/i.test(html);
}

/**
 * A note, written: a few lines, bullet and numbered lists, bold, italic,
 * strike, code and links — a calendar event's description. ProseMirror on
 * a schema of just that (`note-schema.ts`), and no buttons: everything
 * comes from its Markdown syntax as it is typed (`noteRules`: `- `, `1. `,
 * `**bold**`, `*italic*`, `~strike~`, `[words](address)`, an address then
 * a space) and from its keys (`noteKeys`); an address pasted over words
 * links them.
 *
 *     <note-editor [formField]="form.description" placeholder="Add description" />
 *
 * A signal-forms control (`FormValueControl`): the value is the note's
 * Markdown, `''` while it holds nothing. Copied, it is Markdown (and rich
 * text, where that is read); pasted Markdown is what it says — from a
 * code editor too, whose own HTML is only the text, styled. Mod-Enter
 * submits the form it is in, as an email's Send does; Enter is a new
 * paragraph (or item), Shift+Enter a line break. Backspace in an empty
 * note says `putAway` — the host takes the note back where it came from.
 */
@Component({
  selector: 'note-editor',
  template: '',
  styleUrl: './note-editor.scss',
  // ProseMirror writes the words' elements.
  encapsulation: ViewEncapsulation.None,
})
export class NoteEditor implements FormValueControl<string> {
  readonly #injector = inject(Injector);

  readonly value = model('');

  /** The first line's words while there are none. */
  readonly placeholder = input('');
  /** The editor's name, said for it. */
  readonly label = input('');

  /** Backspace in an empty note: the host puts it away. */
  readonly putAway = output<void>();

  #view: EditorView | null = null;
  /** The value as this editor last wrote it — one from outside is read in. */
  #written = '';

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      this.#written = this.value();
      this.#view = new EditorView(host, {
        state: EditorState.create({
          doc: noteDoc(this.#written),
          plugins: [
            history(),
            inputRules({ rules: [...noteRules] }),
            keymap({
              ...noteKeys,
              // Sent, as an email is: the form the note is in.
              'Mod-Enter': () => (host.closest('form')?.requestSubmit(), true),
              'Shift-Enter': breakLine,
              Backspace: chainCommands(undoInputRule, noteKeys['Backspace'], (state) => {
                if (!noteEmpty(state.doc)) return false;
                this.putAway.emit();
                return true;
              }),
              'Mod-z': undo,
              'Mod-y': redo,
              'Mod-Shift-z': redo,
            }),
            keymap(baseKeymap),
            placeholder(() => this.placeholder()),
          ],
        }),
        attributes: {
          class: 'note-editor__text',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': this.label(),
        },
        clipboardTextSerializer: sliceMarkdown,
        // Shift-pasted, plain: the words as they are, no Markdown read.
        clipboardTextParser: (text, _, plain) => (plain ? linesSlice(text) : markdownSlice(text)),
        handlePaste: (view, event) => {
          const text = event.clipboardData?.getData('text/plain') ?? '';
          const html = event.clipboardData?.getData('text/html') ?? '';
          if (isAddress(text) && setLink(linkHref(text))(view.state, view.dispatch)) return true;
          if (!text || !html || !fromCodeEditor(html)) return false;
          view.dispatch(view.state.tr.replaceSelection(markdownSlice(text)).scrollIntoView());
          return true;
        },
        dispatchTransaction: (tr) => {
          const view = this.#view!;
          view.updateState(view.state.apply(tr));
          if (!tr.docChanged) return;
          this.#written = noteMarkdown(view.state.doc);
          this.value.set(this.#written);
        },
      });
    });

    // A value from outside (a form reset, another editor of the same
    // event): read in.
    effect(() => {
      const value = this.value();
      const view = this.#view;
      if (!view || value === this.#written) return;
      this.#written = value;
      view.updateState(EditorState.create({ doc: noteDoc(value), plugins: view.state.plugins }));
    });

    inject(DestroyRef).onDestroy(() => this.#view?.destroy());
  }

  /** The caret in the note, at its end — as a form sends you to it. */
  focus(): void {
    const view = this.#view;
    if (!view) {
      afterNextRender(() => this.focus(), { injector: this.#injector });
      return;
    }
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  }
}
