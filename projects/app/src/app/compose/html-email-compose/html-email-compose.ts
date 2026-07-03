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
} from '@angular/core';

// Library
import { Editor, createEditor, formatHTML, htmlSourceExtensions } from 'angular-email-editor';

/**
 * The HTML side of the composer: a ProseMirror editor over the source kit
 * (code lines, highlighting, linting, Shift-Alt-F formatting), mounted
 * directly into the host element — no template at all.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'section[html-email-compose]',
  template: '',
  styleUrl: './html-email-compose.scss',
})
export class HtmlEmailCompose {
  #destroyRef = inject(DestroyRef);
  #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Two-way bound by the parent composer. This editor publishes raw source
      text; the canonical form comes back once the email schema parsed it. */
  html = model('');

  editor = signal<Editor | undefined>(undefined);

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
      extensions: htmlSourceExtensions,
      attributes: { role: 'textbox', 'aria-label': 'Email HTML source' },
      onUpdate: (editor) => this.html.set(editor.getText()),
    });
    this.editor.set(editor);
  }
}
