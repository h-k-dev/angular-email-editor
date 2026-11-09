import { InjectionToken, Signal, inject } from '@angular/core';
import { Editor } from '@h-k-dev/angular-email-editor';

/** An editor someone holds — what a toolbar, a menu or a model next to it
    needs (`injectEditor`). */
export interface EditorRef {
  /** The editor once mounted; `undefined` before, and between two kits. */
  readonly editor: Signal<Editor | undefined>;
  /** Puts the caret in the text — now, or as the editor mounts. */
  focus(): void;
}

/**
 * The editor of the island one stands on: an `[emailEditor]` provides
 * itself to what is inside it, and a component whose editor sits *beside*
 * its toolbar and menus — or whose menus open in an overlay, out of the
 * DOM but still in its injector — provides it for all of them:
 *
 *     providers: [{ provide: EMAIL_EDITOR, useExisting: MyComposer }]
 *
 * What stands on the island then needs no editor bound: `injectActions()`,
 * a bare `emailImageAlt`, a bare `emailImageSource`.
 */
export const EMAIL_EDITOR = new InjectionToken<EditorRef>('EMAIL_EDITOR');

/** The island's editor ({@link EMAIL_EDITOR}) — the nearest `[emailEditor]`
    from inside it, or the component that provides one. Call in an
    injection context. */
export function injectEditor(): EditorRef;
export function injectEditor(options: { optional: true }): EditorRef | null;
export function injectEditor(options: { optional?: boolean } = {}): EditorRef | null {
  return inject(EMAIL_EDITOR, { optional: options.optional ?? false });
}

/** A directive's own editor binding: an editor, nothing yet (`undefined`) —
    or the bare attribute (`''`), which asks for the island's. */
export type BoundEditor = Editor | '' | undefined;

/**
 * The editor a directive acts on: the one bound to it, else — the attribute
 * bare — the island's ({@link EMAIL_EDITOR}). Bare with no island is a
 * mistake, and said so; a bound `undefined` is an editor not there yet.
 * Call in an injection context.
 */
export function resolveEditor(own: () => BoundEditor, selector: string): () => Editor | undefined {
  const island = inject(EMAIL_EDITOR, { optional: true });
  return () => {
    const bound = own();
    if (bound !== '') return bound;
    if (!island) {
      throw new Error(
        `[${selector}] has no editor: bind one ([${selector}]="editor"), ` +
          `or provide EMAIL_EDITOR on an ancestor.`,
      );
    }
    return island.editor();
  };
}
