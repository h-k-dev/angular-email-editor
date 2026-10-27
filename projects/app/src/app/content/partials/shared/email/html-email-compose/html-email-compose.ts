import {
  Component,
  ElementRef,
  inject,

  // Signals
  computed,
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
  Extension,
  HtmlDiagnostic,
  createHtmlAutocomplete,
  createHtmlLanguage,
  createOffsetMapper,
  formatHTML,
  htmlSourceExtensions,
  lintHTML,
  SourceOptions,
  TYPING_REST,
} from '@h-k-dev/angular-email-editor';
import { EditorCodec, EmailEditor } from '@h-k-dev/angular-email-editor/editor';
import { Preferences } from '../../../../../core/storages/preferences';
import { FloatingScrollbar } from '../../../common/floating-scrollbar/floating-scrollbar';
/**
 * The HTML side of the composer: a ProseMirror editor over the source kit
 * (code lines, highlighting, linting, Shift-Alt-F formatting, email-safe
 * autocomplete), mounted by `[emailEditor]` on a box that lays out as the
 * host itself (`display: contents`) — beside it, the autocomplete listbox.
 */
/** The source is read the way the visual editor parses it — the library's
    default `email` mode: markup kept as authored, lint on what it drops. */
const SOURCE: SourceOptions = { mode: 'email' };

/** The source as text: what it is shown lands pretty-printed, and stands
    as given — the email editor's HTML is not sent back reformatted; only
    the user's own edits go out. */
const SOURCE_CODEC: EditorCodec = {
  read: (editor) => editor.getText(),
  write: (editor, html, options) => editor.setText(formatHTML(html, undefined, undefined, SOURCE), options),
  canonical: false,
};

@Component({
  selector: 'section[html-email-compose]',
  imports: [FloatingScrollbar, EmailEditor],
  templateUrl: './html-email-compose.html',
  styleUrl: './html-email-compose.scss',
  host: {
    '[attr.data-wrap]': "wrap() ? null : 'off'",
    '(keydown)': 'onKeydown($event)',
  },
})
export class HtmlEmailCompose {

  /** Two-way bound by the parent composer. This editor publishes raw source
      text; the canonical form comes back once the email schema parsed it. */
  html = model('');

  /** VS Code's word wrap, and its Alt+Z: on, a line wider than the pane
      wraps at word boundaries and continues under its own indentation
      (`CodeLineIndent`, the styles in styles.scss); off, it stays one line
      and the pane scrolls sideways. On by default; a {@link Preferences}
      one — the settings' Word wrap switches it too, and this browser keeps
      it for every source pane. */
  readonly wrap = inject(Preferences).sourceWrap;

  /** Live lint results, published upward for the composer's problems strip. */
  diagnostics = model<HtmlDiagnostic[]>([]);

  /** Whether the pane is on screen. While it is not, incoming html is not
      applied to the editor — no DOM for a pane nobody sees — and the
      diagnostics are linted from the text alone, exactly as the editor would
      lint it (the same formatted source), so the problems strip stays live.
      Shown again, the editor catches up and lints itself. */
  active = input(true);

  menu = viewChild.required<ElementRef<HTMLElement>>('menu');
  completions = signal<AutocompleteState | undefined>(undefined);

  /** The source's editor (`[emailEditor]`): mounting, the text both ways —
      held while it is typed in, taken as typing in the email editor rests,
      and left alone while the pane is out of sight (`active`). */
  // A query cannot be an ES-private field: TypeScript's `private` it is.
  private readonly surface = viewChild.required(EmailEditor);
  readonly editor = computed(() => this.surface().editor());

  protected readonly codec = SOURCE_CODEC;
  protected readonly editorOptions = {
    attributes: { role: 'textbox', 'aria-label': 'Email HTML source' },
  };

  /** The kit, made as the editor mounts: the source kit, its language
      service swapped for one that reports diagnostics upward, and the
      autocomplete in this pane's listbox. */
  protected readonly kit = (): Extension[] => [
    ...htmlSourceExtensions.filter((extension) => extension.name !== 'htmlLanguage'),
    createHtmlLanguage({ onDiagnostics: (diagnostics) => this.diagnostics.set(diagnostics) }),
    createHtmlAutocomplete({
      element: this.menu().nativeElement,
      onChange: (state) => this.completions.set(state),
    }),
  ];

  /** `html` once typing in the email editor rests — the hidden pane's lint. */
  readonly #rest = debounced(() => this.html(), TYPING_REST);

  /** Alt+Z, as in VS Code: word wrap on or off. */
  protected onKeydown(event: KeyboardEvent): void {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== 'KeyZ') return;
    event.preventDefault();
    this.wrap.update((wrap) => !wrap);
  }

  constructor() {
    // Out of sight, the editor is left alone (`emailEditorPaused`) and the
    // diagnostics are linted from the text alone, exactly as the editor
    // would lint it (the same formatted source), so the problems strip
    // stays live — as typing in the email editor rests: each run re-formats
    // and re-lints the whole email. Shown again, the editor catches up and
    // lints itself.
    effect(() => {
      const active = this.active();
      this.#rest.value();
      untracked(() => {
        if (active) return;
        this.diagnostics.set(
          lintHTML(formatHTML(this.html(), undefined, undefined, SOURCE), undefined, SOURCE),
        );
      });
    });
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
