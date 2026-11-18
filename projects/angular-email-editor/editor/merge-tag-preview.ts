import {
  Directive,
  Injector,
  Signal,
  computed,
  effect,
  inject,
  input,
  model,
  untracked,
} from '@angular/core';
import {
  type Editor,
  mergeTagPreviewOn,
  mergeTagPreviewPending,
} from '@h-k-dev/angular-email-editor';
import { EMAIL_EDITOR, editorState } from '@h-k-dev/angular-email-editor/actions';

/**
 * The placeholder preview of an editor, as a host's bar sees it: whether
 * the values are shown, whether some are still on their way, and the two
 * things to do about it. The reactive face of `createMergeTagPreview()`,
 * which the editor's kit must hold.
 */
export interface EditorMergeTagPreview {
  /** The editor's kit holds `createMergeTagPreview()`: there is a preview to
      turn on. False before the editor is mounted. */
  readonly available: Signal<boolean>;
  /** The values are shown in the tokens' places. */
  readonly on: Signal<boolean>;
  /** On, and some values are still out with the host's evaluator. */
  readonly pending: Signal<boolean>;
  /** Shows the values (`true`), the tokens (`false`), or the other of the
      two (no argument). False when nothing changed — no editor yet, no
      preview in its kit, off already. */
  show(on?: boolean): boolean;
  /** Asks for every value afresh — the record they are read from changed.
      A no-op while off: turned on, it asks anyway. */
  refresh(): boolean;
}

/**
 * The placeholder preview of an editor, bound and live — for a host that
 * holds it from code:
 *
 *     readonly preview = injectMergeTagPreview(() => this.editor());
 *
 *     <button (click)="preview.show()" [attr.aria-pressed]="preview.on()">…</button>
 *
 * `editor` is read reactively: the preview follows the editor it is given.
 * In a template, `[emailMergeTagPreview]` does the same from a binding.
 * Call in an injection context, or hand it an injector.
 */
export function injectMergeTagPreview(
  editor: () => Editor | undefined,
  options: { injector?: Injector } = {},
): EditorMergeTagPreview {
  const state = editorState(editor, options);
  const run = (on?: boolean): boolean => {
    const current = editor();
    const command = current && !current.view.isDestroyed && current.commands['previewMergeTags'];
    return command ? command(on) : false;
  };
  const on = computed(() => {
    const now = state();
    return !!now && mergeTagPreviewOn(now);
  });
  return {
    available: computed(() => !!state() && !!editor()?.commands['previewMergeTags']),
    on,
    pending: computed(() => {
      const now = state();
      return !!now && mergeTagPreviewPending(now);
    }),
    show: run,
    refresh: () => untracked(on) && run(true),
  };
}

/**
 * The placeholder preview, bound: the document's `{{ tokens }}` shown as
 * their values while the binding is true — and nothing written, so the
 * value bound to the editor is the template still.
 *
 *     <div [emailEditor]="kit" [(value)]="html"
 *          [(emailMergeTagPreview)]="filled" [emailMergeTagPreviewOf]="caseId()"
 *          #preview="emailMergeTagPreview"></div>
 *
 *     <button (click)="filled.set(!filled())" [attr.aria-pressed]="filled()">Preview</button>
 *     @if (preview.pending()) { <mat-spinner /> }
 *
 * - **Two-way**: turned on or off by anything else — the
 *   `preview-placeholders` action's button, a `/` row, the command — the
 *   binding follows. A new editor (another kit) starts off, and says so.
 * - **`emailMergeTagPreviewOf`** is whatever the values are read from — a
 *   record's id, the record. When it changes while the preview is on,
 *   every value is asked for afresh. Its value is never looked into: only
 *   that it changed.
 * - **The editor** is the island's — the `[emailEditor]` it stands on or
 *   inside, or a component that provides `EMAIL_EDITOR` — or the one bound
 *   to `emailMergeTagPreviewEditor`.
 * - **The evaluator** is the kit's: `createMergeTagPreview({ resolve })`,
 *   the contract of the fill's — one function serves both. Turning the
 *   preview on in an editor whose kit has none is a mistake, and said so.
 *
 * Behaviour only: no template, no styles, no key.
 */
@Directive({ selector: '[emailMergeTagPreview]', exportAs: 'emailMergeTagPreview' })
export class MergeTagPreviewSwitch {
  /** The values are shown. Two-way. */
  readonly on = model(false, { alias: 'emailMergeTagPreview' });

  /** What the values are read from; a change while on asks afresh. */
  readonly of = input<unknown>(undefined, { alias: 'emailMergeTagPreviewOf' });

  /** The editor, when it is not the island's. */
  readonly bound = input<Editor | undefined>(undefined, { alias: 'emailMergeTagPreviewEditor' });

  readonly #island = inject(EMAIL_EDITOR, { optional: true });
  readonly #editor = computed(() => this.bound() ?? this.#island?.editor());
  readonly #preview = injectMergeTagPreview(this.#editor);

  /** On, and some values are still on their way. */
  readonly pending = this.#preview.pending;
  /** The editor's kit holds the preview. */
  readonly available = this.#preview.available;

  /** What binding and editor last agreed on. */
  #agreed = false;
  /** The record the values shown were asked for. */
  #of: unknown;

  constructor() {
    // The binding, into the editor — and a new record, asked for afresh.
    effect(() => {
      const on = this.on();
      const of = this.of();
      const editor = this.#editor();
      untracked(() => {
        if (!editor) return;
        const changed = of !== this.#of;
        this.#of = of;
        if (on !== this.#agreed) {
          if (!editor.commands['previewMergeTags']) {
            throw new Error(
              '[emailMergeTagPreview]: the editor has no preview — add createMergeTagPreview({ resolve }) to its kit.',
            );
          }
          this.#preview.show(on);
          this.#agreed = on;
        } else if (on && changed) {
          this.#preview.refresh();
        }
      });
    });

    // The editor, into the binding: turned on or off by anything else.
    effect(() => {
      const on = this.#preview.on();
      untracked(() => {
        if (on === this.#agreed) return;
        this.#agreed = on;
        this.on.set(on);
      });
    });
  }
}
