import {
  DestroyRef,
  Directive,
  ElementRef,
  InjectionToken,
  Injector,
  Signal,
  afterNextRender,
  booleanAttribute,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import type { EditorView } from 'prosemirror-view';
import {
  type ContentOptions,
  type Editor as EditorHandle,
  type EditorOptions,
  type Extension,
  createEditor,
} from '@h-k-dev/angular-email-editor';
import { atRest } from '@h-k-dev/angular-email-editor/actions';

/** What an editor is made of: its extensions — or a function that gives
    them, called as the editor mounts (a render in, so it may read the
    host's view queries: a menu's element, a component's method). A new
    kit — another array, another function — is another editor. */
export type EditorKit = readonly Extension[] | (() => readonly Extension[]);

/**
 * How a value and an editor meet: read the value off the editor, write one
 * into it. The default is HTML ({@link HTML_CODEC}); a source pane reads
 * and writes text.
 */
export interface EditorCodec {
  read(editor: EditorHandle): string;
  /** `history`: as a step of the undo history ({@link EmailEditor.replace}),
      not an outside sync. */
  write(editor: EditorHandle, value: string, options?: ContentOptions): void;
  /** Whether the editor's reading after a write is the value to publish —
      HTML through the schema comes back as what the schema kept, and that
      canonical form goes out (true) — or the value written stands as given,
      and nothing goes out until the user writes (false: a pane that only
      pretty-prints what it is shown). */
  readonly canonical: boolean;
}

/** HTML, through the schema: what goes in comes back canonical. */
export const HTML_CODEC: EditorCodec = {
  read: (editor) => editor.getHTML(),
  write: (editor, value, options) => editor.setContent(value, options),
  canonical: true,
};

/** An editor someone holds — what a toolbar, a menu or a model next to it
    needs (`injectEditor`). */
export interface EditorRef {
  /** The editor once mounted; `undefined` before, and between two kits. */
  readonly editor: Signal<EditorHandle | undefined>;
  /** Puts the caret in the text — now, or as the editor mounts. */
  focus(): void;
}

/** The nearest editor (`[emailEditor]` provides itself). */
export const EMAIL_EDITOR = new InjectionToken<EditorRef>('EMAIL_EDITOR');

/** The nearest `[emailEditor]`'s editor, from inside it — a toolbar or a menu
    in its subtree, or a component that provides {@link EMAIL_EDITOR}
    itself. Call in an injection context. */
export function injectEditor(): EditorRef;
export function injectEditor(options: { optional: true }): EditorRef | null;
export function injectEditor(options: { optional?: boolean } = {}): EditorRef | null {
  return inject(EMAIL_EDITOR, { optional: options.optional ?? false });
}

/**
 * Whether the user is typing into this view right now: it holds focus *and*
 * its window does. ProseMirror's `hasFocus()` only asks whether the view is
 * the document's active element — and it stays that while its tab sits in
 * the background, where a write held back on that answer (a draft saved in
 * another tab) would wait for a blur that has already happened.
 */
export function isTyping(view: EditorView): boolean {
  return view.hasFocus() && view.dom.ownerDocument.hasFocus();
}

/**
 * An editor on this element, its value bound — the part of every composer
 * that is the same everywhere and easy to get subtly wrong:
 *
 *     <div [emailEditor]="kit" [formField]="form.body" #body="emailEditor"></div>
 *
 * - **Mounted** a render in (ProseMirror writes the DOM and reads it back),
 *   destroyed with the element. A new kit mounts a new editor in the old
 *   one's place, a render later — the old one takes nothing in meanwhile,
 *   so a value converted for the new kit never goes through the old schema.
 * - **The value both ways** — a `FormValueControl<string>`, or
 *   `[(value)]`. Every change of the document goes out. A value from
 *   outside goes in as typing settles (`atRest`) — never into an editor the
 *   user is typing in: it waits, and is taken the moment the user leaves the
 *   text or comes back to it (last writer wins). The editor's own value
 *   coming back is no change.
 * - **Canonical**: given HTML, the editor publishes what its schema kept
 *   ({@link HTML_CODEC}); {@link baseline} is that form as it mounted, so
 *   "unsaved" is `value() !== baseline()`, never a false alarm on open.
 * - **{@link replace}** writes even into a focused editor, as one undo
 *   step — a Revert.
 * - `disabled` and `readonly` (the form's) make it read-only; leaving the
 *   text is `touch`.
 * - It provides itself as {@link EMAIL_EDITOR}.
 *
 * Behaviour only: no template, no styles; the element is the host's.
 */
@Directive({
  selector: '[emailEditor]',
  exportAs: 'emailEditor',
  providers: [{ provide: EMAIL_EDITOR, useExisting: EmailEditor }],
})
export class EmailEditor implements FormValueControl<string>, EditorRef {
  /** The kit — see {@link EditorKit}. */
  readonly kit = input.required<EditorKit>({ alias: 'emailEditor' });

  /** The value, as the codec reads it — canonical HTML by default. */
  readonly value = model('');

  /** How value and editor meet. Read as an editor mounts. */
  readonly codec = input<EditorCodec>(HTML_CODEC, { alias: 'emailEditorCodec' });

  /** The rest of `createEditor`'s options — attributes, parse mode. Read as
      an editor mounts. */
  readonly options = input<Pick<EditorOptions, 'attributes' | 'parseMode'>>(
    {},
    { alias: 'emailEditorOptions' },
  );

  /** While true, a value from outside waits — a pane out of sight need not
      parse what nobody sees — and goes in as soon as it is false. The
      editor's own changes still go out. */
  readonly paused = input(false, { alias: 'emailEditorPaused', transform: booleanAttribute });

  /** The form's: read-only while either is true. */
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly readonly = input(false, { transform: booleanAttribute });

  /** An editor was mounted — the first, or one on a new kit — before it
      takes the value in. */
  readonly mounted = output<EditorHandle>({ alias: 'emailEditorMounted' });

  /** The document changed — by the user, or a command; not by a value
      written in. */
  readonly changed = output<EditorHandle>({ alias: 'emailEditorChange' });

  /** Focus left the text: the form marks the field touched. */
  readonly touch = output<void>();

  readonly #editor = signal<EditorHandle | undefined>(undefined);
  readonly editor = this.#editor.asReadonly();

  readonly #baseline = signal<string | null>(null);
  /** The value as this editor first published it — canonical — once
      mounted; null before. A new kit mounts with a new baseline. */
  readonly baseline = this.#baseline.asReadonly();

  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #injector = inject(Injector);

  /** The kit the editor in place was made with. */
  #mountedKit: EditorKit | null = null;
  /** The codec it was made with. */
  #codec: EditorCodec = HTML_CODEC;
  /** The value this editor last published (or, for a codec that is not
      canonical, last took in): checking a value from outside is a string
      compare, not another serialization. */
  #published: string | null = null;
  /** The element that had focus when {@link focus} was asked before there
      was an editor — the caret goes in as it mounts if nothing else took
      focus since. */
  #focusAsked: Element | null | undefined;

  /** `value`, settled — the editor's own publishes pass at once. */
  readonly #incoming = atRest(() => this.value(), {
    passes: (value) => value === this.#published,
  });

  constructor() {
    // No phase: mounting writes the DOM and reads it back in one go.
    afterNextRender(() => this.#mount());
    inject(DestroyRef).onDestroy(() => this.#editor()?.destroy());

    // A new kit: the editor in place takes nothing in from now on, and a
    // new one stands in its place after the render that brought the value
    // converted for it.
    effect(() => {
      const kit = this.kit();
      untracked(() => {
        if (!this.#mountedKit || kit === this.#mountedKit) return;
        afterNextRender(
          () => {
            if (this.kit() !== this.#mountedKit) this.#remount();
          },
          { injector: this.#injector },
        );
      });
    });

    // A value from outside, settled, while nobody types into the editor.
    effect(() => {
      this.#incoming.value();
      const paused = this.paused();
      const editor = this.#editor();
      untracked(() => {
        if (!editor || paused || isTyping(editor.view)) return;
        this.#take(editor);
      });
    });

    effect(() => {
      const locked = this.disabled() || this.readonly();
      this.#editor()?.view.setProps({ editable: () => !locked });
    });
  }

  /** Puts `value` in, even while the user is typing, as one undo step —
      and publishes what the editor made of it. Without an editor yet, it
      is the value it mounts with. */
  replace(value: string): void {
    const editor = this.#editor();
    if (!editor || this.#stale()) {
      this.value.set(value);
      return;
    }
    this.#write(editor, value, { history: true });
  }

  /** Puts the caret in the text — now, or as the editor mounts if focus is
      still where it was asked from. The form's way in (`focusBoundControl`). */
  focus(): void {
    const editor = this.#editor();
    if (editor && !this.#stale()) {
      editor.focus();
      return;
    }
    this.#focusAsked = this.#host.ownerDocument.activeElement;
  }

  /** The editor in place was made from another kit than the one asked for. */
  #stale(): boolean {
    return this.#mountedKit !== null && this.kit() !== this.#mountedKit;
  }

  /** Takes the value in, when it is not what the editor already says. */
  #take(editor: EditorHandle): void {
    if (this.#stale()) return;
    const incoming = this.value();
    if (incoming === (this.#published ??= this.#codec.read(editor))) return;
    this.#write(editor, incoming);
  }

  #write(editor: EditorHandle, value: string, options?: ContentOptions): void {
    this.#codec.write(editor, value, options);
    if (this.#codec.canonical) this.#publish(editor);
    else this.#published = value;
  }

  /** Reads the editor once and publishes it. */
  #publish(editor: EditorHandle): void {
    this.#published = this.#codec.read(editor);
    this.value.set(this.#published);
  }

  #mount(): void {
    const kit = this.kit();
    const codec = this.codec();
    this.#mountedKit = kit;
    this.#codec = codec;
    this.#published = null;
    const extensions = typeof kit === 'function' ? kit() : kit;
    const editor = createEditor({
      ...this.options(),
      parent: this.#host,
      extensions: [...extensions],
      onUpdate: (current) => {
        this.#publish(current);
        this.changed.emit(current);
      },
    });
    // A value held back while the user typed goes in as they leave the
    // text — and as they come back to it: a window switch keeps the editor
    // the active element, so a write that landed while the tab was in the
    // background is taken before the first key, not typed over.
    editor.view.dom.addEventListener('blur', () => {
      this.#take(editor);
      this.touch.emit();
    });
    editor.view.dom.addEventListener('focus', () => this.#take(editor));
    this.mounted.emit(editor);
    this.#editor.set(editor);
    // Whatever the value already is — a draft restored before there was an
    // editor — goes in first; only then is the editor's form published.
    // Publishing the empty document it mounted with would write over it.
    // Paused, it waits like any other value from outside.
    const value = this.value();
    if (!this.paused() && (value !== '' || codec.canonical)) this.#write(editor, value);
    this.#baseline.set(this.#published ?? value);
    const asked = this.#focusAsked;
    this.#focusAsked = undefined;
    if (asked !== undefined && this.#host.ownerDocument.activeElement === asked) editor.focus();
  }

  #remount(): void {
    this.#editor()?.destroy();
    this.#editor.set(undefined);
    this.#mount();
  }
}
