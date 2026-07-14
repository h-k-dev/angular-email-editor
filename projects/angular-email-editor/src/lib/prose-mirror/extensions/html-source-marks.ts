import { Command, EditorState, TextSelection } from 'prosemirror-state';
import { Node, Schema } from 'prosemirror-model';
import {
  CommandFactory,
  Extension,
  ExtensionContext,
  FunctionalExtension,
  defineExtension,
} from '../extension';
import { createSchema } from '../schema';
import { parseHTML, serializeToHTML } from '../html';
import { entitySpans, formatHTML, scanHTML } from '../html-source';
import { createOffsetMapper, docText, textOffsetAt } from './html-language';

/** Private-use sentinels that ride through parse → command → serialize,
    giving an exact selection mapping between source text and rich document. */
const MARK_START = '\uE000';
const MARK_END = '\uE001';

export interface SourceMarksOptions {
  /** The rich-text extension set whose schema defines the mark semantics —
      pass the same kit the visual editor runs so both sides toggle alike. */
  extensions: Extension[];
}

/**
 * Rich-text mark editing for the HTML source editor: every mark extension's
 * keymap (Mod-B, Mod-I, ...) and commands are mirrored, but instead of string
 * surgery the selected source is parsed through the rich schema, the original
 * mark command runs on the resulting document, and the source is replaced
 * with the re-serialized, formatted result. Toggling therefore behaves
 * exactly like the visual editor — it *is* the visual editor's command.
 *
 * Side effect by design: the command pipeline canonicalizes, so running one
 * also repairs and formats the document, like Shift-Alt-F does.
 */
export const createSourceMarks = ({ extensions }: SourceMarksOptions): FunctionalExtension => {
  const schema = createSchema(extensions);
  const ctx: ExtensionContext = { schema, extensions };

  const keymap: Record<string, Command> = {};
  const commands: Record<string, CommandFactory> = {};
  for (const extension of extensions) {
    if (extension.type !== 'mark') continue;
    for (const [key, command] of Object.entries(extension.keymap?.(ctx) ?? {})) {
      keymap[key] = throughRichSchema(schema, command);
    }
    for (const [name, factory] of Object.entries(extension.commands?.(ctx) ?? {})) {
      commands[name] = (...args) => throughRichSchema(schema, factory(...args));
    }
  }

  return defineExtension({
    name: 'sourceMarks',
    keymap: () => keymap,
    commands: () => commands,
  });
};

/** Wraps a rich-schema command so it can run against source-editor state. */
function throughRichSchema(schema: Schema, richCommand: Command): Command {
  return (state, dispatch) => {
    const lineType = state.schema.nodes['codeLine'];
    if (!lineType || state.selection.empty) return false;

    const source = docText(state.doc);
    const [a, b] = clampToText(
      source,
      textOffsetAt(state.doc, state.selection.from),
      textOffsetAt(state.doc, state.selection.to),
    );
    if (a >= b) return false;
    if (!dispatch) return true;

    // 1. Parse with sentinels marking the selection, then drop them.
    const marked =
      source.slice(0, a) + MARK_START + source.slice(a, b) + MARK_END + source.slice(b);
    let rich = EditorState.create({ doc: parseHTML(marked, schema) });
    const p1 = findChar(rich.doc, MARK_START);
    const p2 = findChar(rich.doc, MARK_END);
    if (p1 < 0 || p2 <= p1) return false;
    {
      const tr = rich.tr.delete(p2, p2 + 1).delete(p1, p1 + 1);
      tr.setSelection(TextSelection.create(tr.doc, p1, p2 - 1));
      rich = rich.apply(tr);
    }

    // 2. The visual editor's own command, on the rich document.
    if (!richCommand(rich, (tr) => (rich = rich.apply(tr)))) return false;

    // 3. Sentinels back in around the resulting selection, serialize, format.
    {
      const { from, to } = rich.selection;
      rich = rich.apply(rich.tr.insertText(MARK_END, to).insertText(MARK_START, from));
    }
    const formatted = formatHTML(serializeToHTML(rich.doc, schema));
    const start = formatted.indexOf(MARK_START);
    const end = formatted.indexOf(MARK_END);
    const cleaned = formatted.replace(MARK_START, '').replace(MARK_END, '');

    // 4. Replace the source document and restore the mapped selection.
    const lines = cleaned
      .split('\n')
      .map((line) => lineType.create(null, line ? state.schema.text(line) : null));
    const tr = state.tr.replaceWith(0, state.doc.content.size, lines);
    if (start >= 0 && end > start) {
      const toPm = createOffsetMapper(tr.doc);
      tr.setSelection(TextSelection.create(tr.doc, toPm(start), toPm(end - 1)));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Shrinks a source range onto visible text: endpoints inside tags or
    comments move to the region edge, surrounding whitespace is dropped, so
    "select the whole line, hit Mod-B" marks exactly the line's text. */
function clampToText(source: string, a: number, b: number): [number, number] {
  const scan = scanHTML(source);
  const blocked: [number, number][] = [
    ...scan.tags.map((tag): [number, number] => [tag.from, tag.to]),
    ...scan.tokens
      .filter((token) => token.type === 'comment')
      .map((token): [number, number] => [token.from, token.to]),
  ];
  const blockedAt = (index: number) => blocked.find(([from, to]) => index >= from && index < to);

  while (a < b) {
    const hit = blockedAt(a);
    if (hit) a = hit[1];
    else if (/\s/.test(source[a])) a++;
    else break;
  }
  while (b > a) {
    const hit = blockedAt(b - 1);
    if (hit) b = hit[0];
    else if (/\s/.test(source[b - 1])) b--;
    else break;
  }

  // Character references are atomic: a sentinel inside '&amp;' would break
  // the reference and change the decoded text. Endpoints expand outward so
  // the whole entity rides along with the selection.
  for (const [from, to] of entitySpans(source)) {
    if (a > from && a < to) a = from;
    if (b > from && b < to) b = to;
  }
  return [a, b];
}

function findChar(doc: Node, char: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    const index = node.isText ? (node.text ?? '').indexOf(char) : -1;
    if (index >= 0) found = pos + index;
    return found < 0;
  });
  return found;
}
