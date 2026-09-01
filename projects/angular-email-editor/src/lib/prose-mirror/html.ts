import {
  DOMOutputSpec,
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  Node,
  Schema,
} from 'prosemirror-model';
import { repairTables } from './extensions/nodes/table';
import { promoteMergeTags } from './extensions/nodes/merge-tag';

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
      const emitDOM = type.spec['emitDOM'] as
        ((mark: unknown, inline: boolean) => DOMOutputSpec) | undefined;
      if (emitDOM) marks[name] = emitDOM;
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

/** Serializes a document (or any node) to an HTML string, e.g. for the email body. */
export function serializeToHTML(doc: Node, schema: Schema): string {
  const fragment = getSerializer(schema).serializeFragment(doc.content);
  const container = document.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
}

/**
 * Parses an HTML string into a document conforming to the schema.
 *
 * Parsing is repair (principle 2), and tables are where foreign markup breaks
 * the rules hardest: real mail arrives with rows of unequal length and spans
 * that reach past the grid. `repairTables` normalizes them here, so every pure
 * consumer of the parser — `importedDocument`, `replyDocument`, the source
 * pane's round trip — sees the same rectangle the editor would.
 *
 * The same principle promotes `{{path}}` tokens in running text into
 * `mergeTag` pills (`promoteMergeTags`): the serialized email carries the raw
 * Handlebars-flavoured text, and parse restores the structured form.
 */
export function parseHTML(html: string, schema: Schema): Node {
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  const parsed = ProseMirrorDOMParser.fromSchema(schema).parse(dom.body);
  return promoteMergeTags(repairTables(parsed, schema), schema);
}
