import { DOMOutputSpec, DOMSerializer, Node, Schema, Slice } from 'prosemirror-model';
import { Command, Selection } from 'prosemirror-state';
import { repairTables } from './extensions/nodes/table';
import {
  dropHidden,
  inheritTextStyles,
  inlineStyles,
  noteOwnWidths,
  unwrapLayoutTables,
} from './import-html';
import { promoteMergeTags } from './extensions/nodes/merge-tag';
import { bareButtons } from './extensions/nodes/button';
import { outlookColumns } from './extensions/nodes/columns';
import {
  DocumentEnvelope,
  hasDocumentEnvelope,
  parseDocument,
  readEnvelope,
  serializeDocument,
} from './envelope';
import { ParseMode } from './parse-mode';
import { createDOMParser, materializeComments, realizeComments, trimInlineBoxes } from './preserve';
import { applyEmailVocabulary } from './email-vocabulary';

const serializerCache = new WeakMap<Schema, DOMSerializer>();

/**
 * A DOMSerializer honouring `emitDOM` node- and mark-spec overrides:
 * serialization-only renderings (email empty lines as `<div><br></div>`,
 * links without editor-only styling) that must not affect the live editor
 * view, which keeps using `toDOM`.
 */
function getSerializer(schema: Schema): DOMSerializer {
  let serializer = serializerCache.get(schema);
  if (!serializer) {
    const nodes = DOMSerializer.nodesFromSchema(schema);
    for (const [name, type] of Object.entries(schema.nodes)) {
      const emitDOM = type.spec['emitDOM'] as ((node: Node) => DOMOutputSpec) | undefined;
      if (emitDOM) nodes[name] = emitDOM;
    }
    const marks = DOMSerializer.marksFromSchema(schema);
    for (const [name, type] of Object.entries(schema.marks)) {
      // A mark may declare `emitDOM: null` — editor-only chrome that leaves
      // no trace in the email (the merge-tag pill): the serializer then skips
      // the mark and emits its text bare.
      if (!('emitDOM' in type.spec)) continue;
      const emitDOM = type.spec['emitDOM'] as
        ((mark: unknown, inline: boolean) => DOMOutputSpec) | null | undefined;
      if (emitDOM) marks[name] = emitDOM;
      else delete (marks as Record<string, unknown>)[name];
    }
    serializer = new DOMSerializer(nodes, marks);
    // A bare string is documented DOMOutputSpec ("a text node") but the
    // fragment serializer predates it — only the static `renderSpec` (the
    // editor view's path) honours it, and `serializeNodeInner` throws trying
    // to use "{{" as a tag name. The merge tag's `emitDOM` is exactly that
    // case: `{{path}}` as raw text. Patch the instance so both the fragment
    // walk and mark wrapping route strings to a text node.
    const inner = (
      serializer as unknown as {
        serializeNodeInner(node: Node, options: object): globalThis.Node;
      }
    ).serializeNodeInner.bind(serializer);
    (serializer as unknown as Record<string, unknown>)['serializeNodeInner'] = (
      node: Node,
      options: object,
    ): globalThis.Node => {
      const spec = nodes[node.type.name]?.(node);
      return typeof spec === 'string' ? document.createTextNode(spec) : inner(node, options);
    };
    serializerCache.set(schema, serializer);
  }
  return serializer;
}

/** Serializes a document (or any node) to an HTML string, e.g. for the email
    body. A document carrying an envelope (see {@link DocumentEnvelope})
    serializes as a whole document — doctype, head and all. */
export function serializeToHTML(doc: Node, schema: Schema): string {
  const fragment = getSerializer(schema).serializeFragment(doc.content);
  const container = document.createElement('div');
  container.appendChild(fragment);
  // The Outlook half of the columns hybrid: comments between the columns,
  // where no node's own emit can put them (columns.ts).
  if (schema.nodes['columns']) outlookColumns(container);
  realizeComments(container);
  const body = container.innerHTML;
  const envelope = doc.attrs['envelope'] as DocumentEnvelope | null | undefined;
  return envelope ? serializeDocument(envelope, body) : body;
}

export interface ParseOptions {
  /** `repair` (this function's default — canonical form), `email` (the
      editor's default — the email vocabulary, kept exactly as authored) or
      `preserve` (anything but executable content). See {@link ParseMode}. */
  mode?: ParseMode;
}

/**
 * Parses an HTML string into a document conforming to the schema.
 *
 * - `repair` (the default here; paste, seeds, templates): parsing is repair
 *   (principle 2). A builder's export leans on its stylesheet, on wrapper
 *   tables and on hiding what a client cannot show; the canonical schema
 *   reads none of those, so the import pipeline (import-html.ts) folds,
 *   unwraps and drops them first.
 * - `email` (the editor's default) and `preserve`: the markup is kept as
 *   authored — comments survive as nodes, a document envelope (`<!doctype>`,
 *   `<html>`, `<head>`, `<body>` attributes) lands on the document node's
 *   `envelope` attribute, and `email` first drops whatever no floor client
 *   applies (email-vocabulary.ts).
 *
 * Every mode then shares the structural repairs. Tables are where foreign
 * markup breaks the rules hardest: real mail arrives with rows of unequal
 * length and spans that reach past the grid, and `repairTables` normalizes
 * the composer's own tables so every pure consumer of the parser —
 * `importedDocument`, `replyDocument`, the source pane's round trip — sees
 * the same rectangle the editor would. `{{path}}` tokens in running text
 * become `mergeTag` pills (`promoteMergeTags`): the serialized email carries
 * the raw Handlebars-flavoured text, and parse restores the structured form.
 * Button atoms lose marks the parser painted from their own `font-weight`
 * (`bareButtons`) — the box is already bold.
 */
export function parseHTML(html: string, schema: Schema, options: ParseOptions = {}): Node {
  const mode = options.mode ?? 'repair';
  const parser = createDOMParser(schema, mode);
  let parsed: Node;

  if (mode === 'repair') {
    const dom = new window.DOMParser().parseFromString(html, 'text/html');
    noteOwnWidths(dom.body);
    inlineStyles(dom);
    dropHidden(dom.body);
    unwrapLayoutTables(dom.body);
    // `<a> home </a>`: a client drops a box's edge spaces, and left in they
    // would collapse into the link beside them, joining a navbar's items.
    trimInlineBoxes(dom.body);
    inheritTextStyles(dom.body);
    parsed = parser.parse(dom.body);
  } else {
    const dom = parseDocument(html);
    if (mode === 'email') applyEmailVocabulary(dom.documentElement);
    materializeComments(dom.body);
    trimInlineBoxes(dom.body);
    const docType = schema.topNodeType;
    const topNode =
      hasDocumentEnvelope(html) && docType.spec.attrs?.['envelope']
        ? docType.create({ envelope: readEnvelope(dom) })
        : undefined;
    parsed = parser.parse(dom.body, topNode ? { topNode } : undefined);
  }
  return bareButtons(promoteMergeTags(repairTables(parsed, schema), schema), schema);
}

/**
 * A command inserting an HTML fragment at the selection — a template, a
 * snippet — parsed exactly as {@link parseHTML} parses a whole document, so
 * tables are repaired and merge tags promoted on the way in. Block content
 * dropped into an empty paragraph takes its place.
 */
export const insertHTML =
  (html: string, options?: ParseOptions): Command =>
  (state, dispatch) => {
    const doc = parseHTML(html, state.schema, options);
    dispatch?.(state.tr.replaceSelection(new Slice(doc.content, 0, 0)).scrollIntoView());
    return true;
  };

/** A command that puts `html` in the whole document's place — an example
    loaded over what is written, as one undoable change; the caret lands at
    its end. A whole document parsed in the `email` or `preserve` mode brings
    its envelope along. */
export const replaceHTML =
  (html: string, options?: ParseOptions): Command =>
  (state, dispatch) => {
    const doc = parseHTML(html, state.schema, options);
    if (dispatch) {
      const tr = state.tr.replaceWith(0, state.doc.content.size, doc.content);
      if (
        JSON.stringify(state.doc.attrs['envelope'] ?? null) !==
        JSON.stringify(doc.attrs['envelope'] ?? null)
      ) {
        tr.setDocAttribute('envelope', doc.attrs['envelope'] ?? null);
      }
      dispatch(tr.setSelection(Selection.atEnd(tr.doc)).scrollIntoView());
    }
    return true;
  };
