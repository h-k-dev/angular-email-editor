import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,

  // Signals
  effect,
  model,
  signal,
  viewChild,
} from '@angular/core';

// ProseMirror
import { TextSelection } from 'prosemirror-state';

// Library
import {
  AutocompleteState,
  Editor,
  HtmlDiagnostic,
  createEditor,
  createHtmlAutocomplete,
  createHtmlLanguage,
  createOffsetMapper,
  formatHTML,
  htmlSourceExtensions,
} from 'angular-email-editor';

/**
 * The HTML side of the composer: a ProseMirror editor over the source kit
 * (code lines, highlighting, linting, Shift-Alt-F formatting, email-safe
 * autocomplete), mounted directly into the host element — the template holds
 * only the autocomplete listbox.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'section[html-email-compose]',
  templateUrl: './html-email-compose.html',
  styleUrl: './html-email-compose.scss',
})
export class HtmlEmailCompose {
  #destroyRef = inject(DestroyRef);
  #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Two-way bound by the parent composer. This editor publishes raw source
      text; the canonical form comes back once the email schema parsed it. */
  html = model('');

  /** Live lint results, published upward for the composer's problems strip. */
  diagnostics = model<HtmlDiagnostic[]>([]);

  menu = viewChild.required<ElementRef<HTMLElement>>('menu');
  editor = signal<Editor | undefined>(undefined);
  completions = signal<AutocompleteState | undefined>(undefined);

  constructor() {
    afterNextRender(() => this.#mountEditor());

    this.#destroyRef.onDestroy(() => this.editor()?.destroy());

    // Incoming html (the email editor's serialization) lands pretty-printed.
    // Skipped while this editor has focus: then it is the origin of the
    // signal value — rewriting would yank the cursor mid-keystroke. `setText`
    // dispatches no transaction, so applying can't echo through `onUpdate`.
    effect(() => {
      const incoming = this.html();
      const editor = this.editor();
      if (!editor || editor.view.hasFocus()) return;
      if (incoming === editor.getText()) return;

      editor.setText(formatHTML(incoming));
    });
  }

  #mountEditor(): void {
    const editor = createEditor({
      parent: this.#host.nativeElement,
      // The kit, with its default language service swapped for one that
      // reports diagnostics upward.
      extensions: [
        ...htmlSourceExtensions.filter((extension) => extension.name !== 'htmlLanguage'),
        createHtmlLanguage({ onDiagnostics: (diagnostics) => this.diagnostics.set(diagnostics) }),
        createHtmlAutocomplete({
          element: this.menu().nativeElement,
          onChange: (state) => this.completions.set(state),
        }),
      ],
      attributes: { role: 'textbox', 'aria-label': 'Email HTML source' },
      onUpdate: (editor) => this.html.set(editor.getText()),
    });
    this.editor.set(editor);
  }

  /** Puts the cursor on a diagnostic and scrolls it into view. */
  reveal(diagnostic: HtmlDiagnostic): void {
    const editor = this.editor();
    if (!editor) return;

    const pos = createOffsetMapper(editor.state.doc)(diagnostic.from);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)).scrollIntoView(),
    );
    editor.focus();
  }
}
