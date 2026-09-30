import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,

  // Signals
  debounced,
  effect,
  input,
  model,
  signal,
  untracked,
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
  lintHTML,
  SourceOptions,
  TYPING_REST,
} from 'angular-email-editor';
import { isTyping } from '../is-typing';
/**
 * The HTML side of the composer: a ProseMirror editor over the source kit
 * (code lines, highlighting, linting, Shift-Alt-F formatting, email-safe
 * autocomplete), mounted directly into the host element — the template holds
 * only the autocomplete listbox.
 */
/** The source is read the way the visual editor parses it — the library's
    default `email` mode: markup kept as authored, lint on what it drops. */
const SOURCE: SourceOptions = { mode: 'email' };

/** Where this browser remembers the wrap choice — a viewer's convenience. */
const WRAP_KEY = 'angular-email-editor:source-wrap';

function storedWrap(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) !== 'off';
  } catch {
    return true;
  }
}

@Component({
  selector: 'section[html-email-compose]',
  templateUrl: './html-email-compose.html',
  styleUrl: './html-email-compose.scss',
  host: {
    '[attr.data-wrap]': "wrap() ? null : 'off'",
    '(keydown)': 'onKeydown($event)',
  },
})
export class HtmlEmailCompose {
  #destroyRef = inject(DestroyRef);
  #host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Two-way bound by the parent composer. This editor publishes raw source
      text; the canonical form comes back once the email schema parsed it. */
  html = model('');

  /** VS Code's word wrap, and its Alt+Z: on, a line wider than the pane
      wraps at word boundaries and continues under its own indentation
      (`CodeLineIndent`, the styles in styles.scss); off, it stays one line
      and the pane scrolls sideways. On by default; this browser remembers the
      choice. Two-way, for a host's own toggle. */
  wrap = model(storedWrap());

  /** Live lint results, published upward for the composer's problems strip. */
  diagnostics = model<HtmlDiagnostic[]>([]);

  /** Whether the pane is on screen. While it is not, incoming html is not
      applied to the editor — no DOM for a pane nobody sees — and the
      diagnostics are linted from the text alone, exactly as the editor would
      lint it (the same formatted source), so the problems strip stays live.
      Shown again, the editor catches up and lints itself. */
  active = input(true);

  menu = viewChild.required<ElementRef<HTMLElement>>('menu');
  editor = signal<Editor | undefined>(undefined);
  completions = signal<AutocompleteState | undefined>(undefined);

  /** `html` once typing in the email editor rests — see the effect below. */
  readonly #rest = debounced(() => this.html(), TYPING_REST);

  /** Alt+Z, as in VS Code: word wrap on or off. */
  protected onKeydown(event: KeyboardEvent): void {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== 'KeyZ') return;
    event.preventDefault();
    this.wrap.update((wrap) => !wrap);
  }

  constructor() {
    effect(() => {
      const wrap = this.wrap();
      try {
        if (wrap) localStorage.removeItem(WRAP_KEY);
        else localStorage.setItem(WRAP_KEY, 'off');
      } catch {
        // No storage (a private window): the choice lasts the page.
      }
    });

    // No phase: mounting ProseMirror writes the DOM and reads it back in
    // one go.
    afterNextRender(() => this.#mountEditor());

    this.#destroyRef.onDestroy(() => this.editor()?.destroy());

    // Incoming html (the email editor's serialization) lands pretty-printed.
    // Skipped while this editor has focus: then it is the origin of the
    // signal value — rewriting would yank the cursor mid-keystroke. `setText`
    // dispatches no transaction, so applying can't echo through `onUpdate`.
    // Hidden, the editor is left alone and only the lint follows the text.
    //
    // At rest, not per keystroke: the email editor publishes on every one,
    // and each run here re-formats the whole email and re-lints it — or
    // rewrites this editor with it, 60–140 ms at Gmail's 102 KB clip. That
    // is longer than a fast typist's gap between two keys, so a throttle
    // would still stall them once a window; it waits for typing to rest
    // (`TYPING_REST`) instead. What is applied is `html` as it is *then*,
    // and showing the pane catches up at once (`active` is read straight).
    effect(() => {
      const active = this.active();
      this.#rest.value();
      const editor = this.editor();
      untracked(() => {
        if (!editor || isTyping(editor.view)) return;
        if (!active) {
          this.diagnostics.set(
            lintHTML(formatHTML(this.html(), undefined, undefined, SOURCE), undefined, SOURCE),
          );
          return;
        }
        this.#applyIncoming(editor);
      });
    });
  }

  /** Applies the signal's current value to the source view, pretty-printed. */
  #applyIncoming(editor: Editor): void {
    const incoming = this.html();
    if (incoming === editor.getText()) return;
    editor.setText(formatHTML(incoming, undefined, undefined, SOURCE));
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
    // External writes must survive focus (see the email pane's twin listener):
    // on blur, catch up with the signal's current value — last writer wins.
    editor.view.dom.addEventListener('blur', () => this.#applyIncoming(editor));
    editor.view.dom.addEventListener('focus', () => this.#applyIncoming(editor));
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
