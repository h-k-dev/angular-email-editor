import {
  DOMOutputSpec,
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  Node,
  Schema,
} from 'prosemirror-model';

const serializerCache = new WeakMap<Schema, DOMSerializer>();

/**
 * A DOMSerializer honouring `emitDOM` node-spec overrides: serialization-only
 * renderings (e.g. email empty lines as `<div><br></div>`) that must not
 * affect the live editor view, which keeps using `toDOM`.
 */
function getSerializer(schema: Schema): DOMSerializer {
  let serializer = serializerCache.get(schema);
  if (!serializer) {
    const nodes = DOMSerializer.nodesFromSchema(schema);
    for (const [name, type] of Object.entries(schema.nodes)) {
      const emitDOM = type.spec['emitDOM'] as ((node: Node) => DOMOutputSpec) | undefined;
      if (emitDOM) nodes[name] = emitDOM;
    }
    serializer = new DOMSerializer(nodes, DOMSerializer.marksFromSchema(schema));
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

/** Parses an HTML string into a document conforming to the schema. */
export function parseHTML(html: string, schema: Schema): Node {
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  return ProseMirrorDOMParser.fromSchema(schema).parse(dom.body);
}
