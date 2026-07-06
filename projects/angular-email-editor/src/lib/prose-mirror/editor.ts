import { Command, EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { MarkType, Node, NodeType, Schema } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { InputRule, inputRules } from 'prosemirror-inputrules';
import { CommandFactory, Extension, ExtensionContext } from './extension';
import { createSchema } from './schema';
import { parseHTML, serializeToHTML } from './html';

export interface EditorOptions {
  /** Element the editable view is mounted into. */
  parent: HTMLElement;
  extensions: Extension[];
  /** Initial content as HTML. */
  content?: string;
  /** DOM attributes for the editable element. */
  attributes?: Record<string, string>;
  /** Called after every transaction that changed the document. */
  onUpdate?: (editor: Editor) => void;
}

export interface Editor {
  view: EditorView;
  schema: Schema;
  readonly state: EditorState;
  /**
   * Named commands collected from all extensions, bound to the live view:
   * `editor.commands.toggleBold()` runs immediately and returns whether it applied.
   */
  commands: Record<string, (...args: any[]) => boolean>;
  /** Runs a raw ProseMirror command against the current state. */
  exec(command: Command): boolean;
  /** Whether a node or mark with the given name (and attrs) is active at the selection. */
  isActive(name: string, attrs?: Record<string, any>): boolean;
  getHTML(): string;
  /** Replaces the document with the given HTML, applied as a minimal diff:
      unchanged content keeps its positions, so selection, scroll and plugin
      state survive. The change counts as an external sync — it never enters
      the undo history and never fires `onUpdate`, so editors mirroring each
      other cannot echo. */
  setContent(html: string): void;
  /** The document as plain text: top-level blocks joined with newlines. */
  getText(): string;
  /** Replaces the document with plain text, one default block per line.
      Same external-sync semantics as {@link setContent}. */
  setText(text: string): void;
  focus(): void;
  destroy(): void;
}

export function createEditor(options: EditorOptions): Editor {
  const schema = createSchema(options.extensions);
  const ctx: ExtensionContext = { schema, extensions: options.extensions };

  // Extension plugins run before all keymaps so interactive plugins (slash
  // menu, ...) can claim keys like Enter ahead of node bindings.
  const extensionPlugins: Plugin[] = [];
  const keymaps: Plugin[] = [];
  const rules: InputRule[] = [];
  const commandFactories: Record<string, CommandFactory> = {};

  for (const extension of options.extensions) {
    if (extension.keymap) keymaps.push(keymap(extension.keymap(ctx)));
    if (extension.inputRules) rules.push(...extension.inputRules(ctx));
    if (extension.plugins) extensionPlugins.push(...extension.plugins(ctx));
    if (extension.commands) Object.assign(commandFactories, extension.commands(ctx));
  }

  const plugins: Plugin[] = [...extensionPlugins, ...keymaps];
  if (rules.length) plugins.push(inputRules({ rules }));

  const view = new EditorView(options.parent, {
    state: EditorState.create({
      doc: options.content ? parseHTML(options.content, schema) : undefined,
      schema,
      plugins,
    }),
    attributes: options.attributes,
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction));
      if (transaction.docChanged && !transaction.getMeta('externalSync')) {
        options.onUpdate?.(editor);
      }
    },
  });

  const exec = (command: Command) => command(view.state, view.dispatch, view);

  const commands: Editor['commands'] = {};
  for (const [name, factory] of Object.entries(commandFactories)) {
    commands[name] = (...args) => exec(factory(...args));
  }

  const editor: Editor = {
    view,
    schema,
    get state() {
      return view.state;
    },
    commands,
    exec,
    isActive(name, attrs) {
      const nodeType = schema.nodes[name];
      if (nodeType) return isNodeActive(view.state, nodeType, attrs);
      const markType = schema.marks[name];
      if (markType) return isMarkActive(view.state, markType);
      return false;
    },
    getHTML: () => serializeToHTML(view.state.doc, schema),
    setContent(html) {
      syncDoc(view, parseHTML(html, schema));
    },
    getText() {
      const lines: string[] = [];
      view.state.doc.forEach((node) => lines.push(node.textContent));
      return lines.join('\n');
    },
    setText(text) {
      const lineType = schema.topNodeType.contentMatch.defaultType;
      if (!lineType) throw new Error('setText: schema has no default block type');
      const lines = text
        .split('\n')
        .map((line) => lineType.create(null, line ? schema.text(line) : null));
      syncDoc(view, schema.topNodeType.create(null, lines));
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };

  return editor;
}

/**
 * Applies a new document as a minimal diff transaction. Content outside the
 * changed range keeps its positions, so the receiving editor's selection,
 * scroll and plugin state survive — and its own undo history stays intact:
 * the sync is flagged `addToHistory: false` (external changes aren't yours
 * to undo) and `externalSync` (so `dispatchTransaction` skips `onUpdate`,
 * keeping mirrored editors echo-free).
 */
function syncDoc(view: EditorView, doc: Node): void {
  const previous = view.state.doc;
  if (previous.eq(doc)) return;

  const start = previous.content.findDiffStart(doc.content);
  if (start === null) return;
  const end = previous.content.findDiffEnd(doc.content);
  if (!end) return;
  let { a: endA, b: endB } = end;
  // With overlapping diffs (repeated content) the end can fall before the
  // start; widen both ends so the replaced range stays valid.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }

  const tr = view.state.tr;
  try {
    tr.replace(start, endA, doc.slice(start, endB));
  } catch {
    // A slice the schema can't fit at that boundary: fall back to replacing
    // the whole document — still a transaction, so history semantics hold.
    tr.replaceWith(0, previous.content.size, doc.content);
  }
  view.dispatch(tr.setMeta('addToHistory', false).setMeta('externalSync', true));
}

export function isMarkActive(state: EditorState, type: MarkType): boolean {
  const { empty, $from, from, to } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

/** Checks the selection's whole ancestor chain, so wrapper nodes
    (blockquote, lists) report active even though the cursor's direct
    parent is a paragraph. */
export function isNodeActive(
  state: EditorState,
  type: NodeType,
  attrs?: Record<string, any>,
): boolean {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type !== type) continue;
    if (!attrs || Object.entries(attrs).every(([key, value]) => node.attrs[key] === value)) {
      return true;
    }
  }

  return false;
}
