import { Command, EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Fragment, Node, Slice } from 'prosemirror-model';
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import { FunctionalExtension, defineExtension } from '../extension';
import {
  HtmlDiagnostic,
  HtmlTokenType,
  VOID_TAGS,
  formatHTML,
  lintHTML,
  openTags,
  scanHTML,
} from '../html-source';

export interface HtmlLanguageOptions {
  /** Called with fresh diagnostics after every document change. */
  onDiagnostics?: (diagnostics: HtmlDiagnostic[]) => void;
}

const TOKEN_CLASSES: Record<HtmlTokenType, string> = {
  delimiter: 'aee-tok-delimiter',
  tagName: 'aee-tok-tag',
  attributeName: 'aee-tok-attr',
  attributeValue: 'aee-tok-value',
  comment: 'aee-tok-comment',
};

/** The document's source text: top-level lines joined with newlines. */
export function docText(doc: Node): string {
  const lines: string[] = [];
  doc.forEach((line) => lines.push(line.textContent));
  return lines.join('\n');
}

/**
 * Maps offsets in the joined source text back to ProseMirror positions.
 * Line i's text starts at `linePm[i]`; the newline between lines has no
 * position of its own, so offsets into it clamp to the line end.
 */
export function createOffsetMapper(doc: Node): (offset: number) => number {
  const lineText: number[] = [];
  const linePm: number[] = [];
  const lineLength: number[] = [];
  let textOffset = 0;
  doc.forEach((line, nodeOffset) => {
    lineText.push(textOffset);
    linePm.push(nodeOffset + 1);
    lineLength.push(line.content.size);
    textOffset += line.textContent.length + 1;
  });

  return (offset) => {
    let low = 0;
    let high = lineText.length - 1;
    let index = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (lineText[mid] <= offset) {
        index = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const column = Math.min(offset - lineText[index], lineLength[index]);
    return linePm[index] + column;
  };
}

function buildDecorations(doc: Node, options: HtmlLanguageOptions): DecorationSet {
  const source = docText(doc);
  const scan = scanHTML(source);
  const diagnostics = lintHTML(source, scan);
  const toPm = createOffsetMapper(doc);

  const decorations: Decoration[] = [];
  for (const token of scan.tokens) {
    const from = toPm(token.from);
    const to = toPm(token.to);
    if (to > from)
      decorations.push(Decoration.inline(from, to, { class: TOKEN_CLASSES[token.type] }));
  }
  for (const diagnostic of diagnostics) {
    const from = toPm(diagnostic.from);
    const to = toPm(diagnostic.to);
    if (to > from) {
      decorations.push(
        Decoration.inline(from, to, {
          class: diagnostic.severity === 'error' ? 'aee-lint-error' : 'aee-lint-warning',
          title: diagnostic.message,
        }),
      );
    }
  }

  options.onDiagnostics?.(diagnostics);
  return DecorationSet.create(doc, decorations);
}

/** Replaces the document with its pretty-printed (and thereby repaired) form. */
const formatDocument: Command = (state, dispatch) => {
  const lineType = state.schema.nodes['codeLine'];
  if (!lineType) return false;

  const source = docText(state.doc);
  const formatted = formatHTML(source);
  if (formatted === source) return true;

  if (dispatch) {
    const lines = formatted
      .split('\n')
      .map((line) => lineType.create(null, line ? state.schema.text(line) : null));
    dispatch(state.tr.replaceWith(0, state.doc.content.size, lines).scrollIntoView());
  }
  return true;
};

/** Maps a ProseMirror position to its offset in the joined source text. */
export function textOffsetAt(doc: Node, pos: number): number {
  let acc = 0;
  let result = 0;
  doc.forEach((line, nodeOffset) => {
    const start = nodeOffset + 1;
    const end = start + line.content.size;
    if (pos >= start - 1 && pos <= end + 1) {
      result = acc + Math.min(Math.max(pos - start, 0), line.content.size);
    }
    acc += line.textContent.length + 1;
  });
  return result;
}

/**
 * Editor-style tag closing: `>` completing a just-typed open tag inserts the
 * matching closing tag with the cursor between them, and `</` completes with
 * the innermost still-open tag. Void tags and self-closing tags are left
 * alone, as is a `>` typed right before an existing matching closer.
 */
function handleTagTyping(view: EditorView, from: number, to: number, text: string): boolean {
  const { state } = view;
  const $from = state.doc.resolve(from);
  if (!$from.parent.type.spec['code']) return false;

  const lineStart = $from.start();
  const before = $from.parent.textContent.slice(0, from - lineStart);
  const after = $from.parent.textContent.slice(to - lineStart);

  if (text === '>') {
    const open = /<([a-zA-Z][-\w]*)([^<>]*)$/.exec(before);
    if (!open || open[2].endsWith('/') || VOID_TAGS.has(open[1].toLowerCase())) return false;
    if (after.startsWith(`</${open[1]}`)) return false;

    const tr = state.tr.insertText(`></${open[1]}>`, from, to);
    tr.setSelection(TextSelection.create(tr.doc, from + 1));
    view.dispatch(tr);
    return true;
  }

  if (text === '/' && before.endsWith('<')) {
    const upToCursor = docText(state.doc).slice(0, textOffsetAt(state.doc, from));
    const name = openTags(upToCursor).at(-1);
    if (!name) return false;

    view.dispatch(state.tr.insertText(`/${name}>`, from, to).scrollIntoView());
    return true;
  }

  return false;
}

/** Pastes multi-line text as proper code lines instead of one long line. */
function handleCodePaste(state: EditorState, text: string | undefined): Slice | null {
  if (!text || !state.selection.$from.parent.type.spec['code']) return null;
  const lineType = state.schema.nodes['codeLine'];
  const lines = text.split(/\r?\n/);
  if (!lineType || lines.length < 2) return null;

  const nodes = lines.map((line) => lineType.create(null, line ? state.schema.text(line) : null));
  // Open sides let ProseMirror merge the first/last line into the cut points.
  return new Slice(Fragment.from(nodes), 1, 1);
}

/**
 * The HTML language service of the source editor kit: syntax-highlight and
 * lint decorations over the document treated as HTML source text, a
 * `formatDocument` command (Shift-Alt-F, VS Code style), tag auto-closing
 * while typing, format-on-blur when the markup is error-free, and line-aware
 * pasting. Diagnostics render as wavy underlines with the message as tooltip.
 *
 * Formatting is presentation-only: the indentation and line breaks it inserts
 * are exactly the whitespace the email schema's parser discards, so the
 * serialized output never changes.
 */
export const createHtmlLanguage = (options: HtmlLanguageOptions = {}): FunctionalExtension => {
  const key = new PluginKey<DecorationSet>('htmlLanguage');
  return defineExtension({
    name: 'htmlLanguage',
    commands: () => ({ formatDocument: () => formatDocument }),
    keymap: () => ({ 'Shift-Alt-f': formatDocument }),
    plugins: () => [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => buildDecorations(state.doc, options),
          apply: (tr, decorations, _prev, state) =>
            tr.docChanged ? buildDecorations(state.doc, options) : decorations,
        },
        props: {
          decorations: (state) => key.getState(state),
          handleTextInput: handleTagTyping,
          handlePaste: (view, event) => {
            const slice = handleCodePaste(view.state, event.clipboardData?.getData('text/plain'));
            if (!slice) return false;
            view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
            return true;
          },
          handleDOMEvents: {
            // Prettier-style: format when leaving the editor, but refuse
            // while the markup has errors — repair stays an explicit choice
            // (Shift-Alt-F). Never returns true: blur must proceed normally.
            blur: (view) => {
              const source = docText(view.state.doc);
              if (lintHTML(source).some((d) => d.severity === 'error')) return false;
              formatDocument(view.state, view.dispatch);
              return false;
            },
          },
        },
      }),
    ],
  });
};

/** Default instance for kits; use {@link createHtmlLanguage} for callbacks. */
export const HtmlLanguage = createHtmlLanguage();
