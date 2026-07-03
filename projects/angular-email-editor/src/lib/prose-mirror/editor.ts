import { Command, EditorState, Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { MarkType, NodeType, Schema } from 'prosemirror-model';
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
  /** Replaces the whole document, e.g. when loading a draft. */
  setContent(html: string): void;
  /** The document as plain text: top-level blocks joined with newlines. */
  getText(): string;
  /** Replaces the document with plain text, one default block per line. */
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
      if (transaction.docChanged) options.onUpdate?.(editor);
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
      const doc = parseHTML(html, schema);
      view.updateState(EditorState.create({ doc, schema, plugins }));
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
      const doc = schema.topNodeType.create(null, lines);
      view.updateState(EditorState.create({ doc, schema, plugins }));
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };

  return editor;
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
