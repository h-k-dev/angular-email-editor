import { Command, EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Node } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';

/** An empty line the placeholder may speak on — what a function-form
    {@link PlaceholderText} is asked with. */
export interface PlaceholderLine {
  /** The empty textblock: a paragraph, a heading, a list item's line. */
  node: Node;
  /** Its position in the document. */
  pos: number;
  /** Whether it is the whole document's only line — the body is empty. */
  docEmpty: boolean;
  state: EditorState;
}

/**
 * The words on an empty line. A string is the same words everywhere — what a
 * host's template hands in through its translate pipe:
 *
 *     [placeholder]="'editor.placeholder' | translate"
 *
 * A function words each line on its own (a heading's "Heading", a list's
 * "List", nothing in a table cell), asked whenever the decorations are drawn;
 * `null` or `''` leaves the line bare.
 */
export type PlaceholderText = string | ((line: PlaceholderLine) => string | null | undefined);

export interface PlaceholderOptions {
  /** The words — see {@link PlaceholderText}. Replaced later with the
      `setPlaceholder` command, which is how a host follows a language
      switch. Default none: the editor shows nothing until it is given words. */
  text?: PlaceholderText;
  /**
   * Which empty lines show it, while the editor is editable:
   * - `'caret'` (default) — the one the caret is on, while the editor has
   *   focus: Notion's. Moving on hides it.
   * - `'all'` — every empty line, focused or not.
   *
   * Either way an empty body shows it on its one line, focused or not: the
   * field says what it is for, as a textarea's placeholder does.
   */
  show?: 'caret' | 'all';
}

interface PlaceholderState {
  text: PlaceholderText | undefined;
}

export const placeholderKey = new PluginKey<PlaceholderState>('placeholder');

/** Replaces the placeholder's words — the line under the caret redraws at
    once. Nothing enters the undo history. */
export const setPlaceholder =
  (text: PlaceholderText | undefined): Command =>
  (state, dispatch) => {
    if (!placeholderKey.get(state)) return false;
    dispatch?.(state.tr.setMeta(placeholderKey, { text }).setMeta('addToHistory', false));
    return true;
  };

const isBare = (node: Node | null | undefined): node is Node =>
  !!node && node.isTextblock && !node.type.spec.code && node.content.size === 0;

/** Whether the document is a single empty line. */
const isDocEmpty = (doc: Node): boolean => doc.childCount === 1 && isBare(doc.firstChild);

const wordsFor = (text: PlaceholderText | undefined, line: PlaceholderLine): string => {
  if (!text) return '';
  return (typeof text === 'string' ? text : text(line)) ?? '';
};

/**
 * A placeholder on empty lines, Notion's way: the line the caret is on says
 * what can be done there ("Type / for commands") and the hint goes as soon as
 * a character is typed or the caret moves on. Nothing of it is in the
 * document — a node decoration puts a class and the words on the line:
 *
 *     <div class="aee-placeholder" data-placeholder="Type / for commands">
 *
 * and the host's stylesheet paints them (`content: attr(data-placeholder)`),
 * so the look stays the host's. An empty body is also marked with
 * `aee-placeholder-doc`, and the editable element carries the words as
 * `aria-placeholder`, so a screen reader hears what the field is for.
 *
 * The words are the host's, in its language — the library words nothing.
 * Hand them in as {@link PlaceholderOptions.text} and replace them with the
 * `setPlaceholder` command whenever they change:
 *
 *     effect(() => editor.commands.setPlaceholder(this.placeholder()));
 *
 * Code lines never show it: an empty line of source is just that. Neither
 * does a read-only editor, nor a line mid-composition (an IME's text is not
 * in the document yet).
 */
export const createPlaceholder = (options: PlaceholderOptions = {}): FunctionalExtension => {
  const show = options.show ?? 'caret';

  return defineExtension({
    name: 'placeholder',
    commands: () => ({ setPlaceholder }),
    plugins: () => {
      let view: EditorView | undefined;
      /** A redraw: focus is not in the state, so its change is no transaction. */
      const redraw = () => {
        if (view) view.dispatch(view.state.tr.setMeta('addToHistory', false));
        return false;
      };

      return [
        new Plugin<PlaceholderState>({
          key: placeholderKey,
          state: {
            init: () => ({ text: options.text }),
            apply: (tr, value) => tr.getMeta(placeholderKey) ?? value,
          },
          props: {
            decorations(state) {
              // No view yet on the first draw: editable, unfocused, not composing.
              if (view && (!view.editable || view.composing)) return null;
              const text = placeholderKey.getState(state)?.text;
              const { doc, selection } = state;
              const decorations: Decoration[] = [];
              const mark = (node: Node, pos: number, docEmpty: boolean) => {
                const words = wordsFor(text, { node, pos, docEmpty, state });
                if (!words) return;
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: docEmpty ? 'aee-placeholder aee-placeholder-doc' : 'aee-placeholder',
                    'data-placeholder': words,
                  }),
                );
              };

              if (isDocEmpty(doc)) {
                mark(doc.firstChild!, 0, true);
              } else if (show === 'all') {
                doc.descendants((node, pos) => {
                  if (isBare(node)) mark(node, pos, false);
                  return !node.isTextblock;
                });
              } else if (selection.empty && view?.hasFocus()) {
                const { $from } = selection;
                if (isBare($from.parent)) mark($from.parent, $from.before(), false);
              }
              return decorations.length ? DecorationSet.create(doc, decorations) : null;
            },
            attributes(state): Record<string, string> {
              if (!isDocEmpty(state.doc)) return {};
              const node = state.doc.firstChild!;
              const text = placeholderKey.getState(state)?.text;
              const words = wordsFor(text, { node, pos: 0, docEmpty: true, state });
              return words ? { 'aria-placeholder': words } : {};
            },
            handleDOMEvents: { focus: redraw, blur: redraw },
          },
          view: (editorView) => {
            view = editorView;
            return {
              destroy: () => {
                view = undefined;
              },
            };
          },
        }),
      ];
    },
  });
};
