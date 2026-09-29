/**
 * Authored markup on the composer's own nodes and marks.
 *
 * In the `email` parse mode every node and mark the schema knows recognizes
 * the markup its parse rule accepts — MJML's styled `<div>` is a paragraph, a
 * hand-written `<table>` a table, `<b class="x">` bold — while the element's
 * tag and attributes ride along **exactly as authored** in an `html` attr.
 * For a node whose rendering is several elements deep (a table and its
 * `<tbody>`, a section's band), every element on the way to the content is
 * kept.
 *
 * The rule for rendering is one sentence: **verbatim until edited, then the
 * edit patched in.** While the modelled attributes are what the parse read,
 * the authored elements render as written. Once a command changes them (an
 * alignment, a cell fill, a link's href), the node's canonical rendering is
 * computed twice — for what was parsed and for what is now — and only that
 * difference is applied to the authored markup: an attribute set or removed,
 * a style declaration replaced in place, appended or dropped. Everything the
 * edit did not touch stays byte for byte.
 *
 * `html` is `null` for the composer's own canonical output and for everything
 * a command creates, which is why the golden corpus is unaffected.
 *
 * Installed once, for every node and mark, by the schema builder
 * ({@link withAuthoredMarkup}); a spec opts out with `authoredMarkup: false`.
 */
import {
  Attrs,
  DOMOutputSpec,
  DOMSerializer,
  Mark,
  MarkSpec,
  Node,
  NodeSpec,
} from 'prosemirror-model';
import { AttributePairs, verbatimElement } from './verbatim';
import { declarationProperty, splitDeclarations } from './email-vocabulary';

export interface AuthoredElement {
  /** Lower-cased tag name as authored. */
  tag: string;
  /** Attributes verbatim, in authored order. */
  attrs: AttributePairs;
}

export interface AuthoredMarkup {
  /** The authored elements from the node's outer element down to the one
      holding its content — one entry for most nodes. */
  path: AuthoredElement[];
  /** The modelled attributes as the parse read them (`html` excluded): the
      baseline an edit is measured against. */
  parsed: Record<string, unknown>;
}

/** The attribute holding authored markup, on every node and mark. */
export const AUTHORED_ATTR = 'html';

/** Spec key: `false` opts a node or mark out of authored markup (the
    preserve family, which is verbatim by construction). */
export const AUTHORED_SPEC_KEY = 'authoredMarkup';

/** Spec key: style values to write instead of *removing* a declaration an
    edit took away — `{ 'text-align': 'left' }` on the paragraph, because an
    authored line usually sits in a container with an alignment of its own
    (MJML cells centre) and a removed declaration would inherit that. */
export const AUTHORED_STYLE_DEFAULTS_KEY = 'authoredStyleDefaults';

/** The canonical render functions, kept beside the wrapped ones. */
const CANONICAL_TO_DOM = 'aeeCanonicalToDOM';
const CANONICAL_EMIT_DOM = 'aeeCanonicalEmitDOM';

type Subject = Node | Mark;
type Render = (subject: any, inline?: boolean) => DOMOutputSpec;

export function authoredMarkupOf(subject: Subject): AuthoredMarkup | null {
  return (subject.attrs[AUTHORED_ATTR] as AuthoredMarkup | null | undefined) ?? null;
}

/** A node or mark spec with the `html` attribute and authored rendering —
    applied by `createSchema` to every spec that does not opt out. */
export function withAuthoredMarkup<T extends NodeSpec | MarkSpec>(spec: T): T {
  if (spec[AUTHORED_SPEC_KEY] === false || !spec.toDOM) return spec;
  if (spec.attrs?.[AUTHORED_ATTR]) return spec;
  const next: Record<string, unknown> = {
    ...spec,
    attrs: { ...(spec.attrs ?? {}), [AUTHORED_ATTR]: { default: null } },
    [CANONICAL_TO_DOM]: spec.toDOM,
  };
  const emit = spec['emitDOM'] as Render | null | undefined;
  next['toDOM'] = authoredRender(spec.toDOM as Render, spec, emit ?? undefined);
  if (emit) {
    next[CANONICAL_EMIT_DOM] = emit;
    next['emitDOM'] = authoredRender(emit, spec);
  }
  return next as T;
}

/** The node's (or mark's) canonical rendering, authored markup ignored —
    what the parse compares an element against. `emit` picks the email's
    rendering over the editor view's. */
export function canonicalRender(
  subject: Subject,
  emit: boolean,
): { dom: globalThis.Node; contentDOM?: HTMLElement } | null {
  const spec = subject.type.spec as Record<string, unknown>;
  const render = ((emit && (spec[CANONICAL_EMIT_DOM] ?? spec['emitDOM'])) ||
    spec[CANONICAL_TO_DOM] ||
    spec['toDOM']) as Render | undefined;
  if (!render) return null;
  const out = render(subject, true);
  if (typeof out === 'string') return null;
  return DOMSerializer.renderSpec(document, out) as {
    dom: globalThis.Node;
    contentDOM?: HTMLElement;
  };
}

/** The elements from a rendering's outer element down to its content hole
    (or the outer element alone for a leaf). */
export function renderedPath(rendered: {
  dom: globalThis.Node;
  contentDOM?: HTMLElement;
}): Element[] | null {
  if (!(rendered.dom instanceof Element)) return null;
  if (!rendered.contentDOM) return [rendered.dom];
  const path: Element[] = [];
  for (let el: Element | null = rendered.contentDOM; el; el = el.parentElement) {
    path.unshift(el);
    if (el === rendered.dom) return path;
  }
  return null;
}

function modelledEqual(subject: Subject, parsed: Record<string, unknown>): boolean {
  for (const [name, value] of Object.entries(subject.attrs)) {
    if (name === AUTHORED_ATTR) continue;
    if (JSON.stringify(value) !== JSON.stringify(parsed[name])) return false;
  }
  return true;
}

function withParsedAttrs(subject: Subject, parsed: Record<string, unknown>): Subject {
  const attrs: Attrs = { ...parsed, [AUTHORED_ATTR]: null };
  return subject instanceof Mark
    ? subject.type.create(attrs)
    : (subject as Node).type.create(attrs);
}

/** A render function that honours authored markup. `viewOf` is set for the
    editor view's rendering (`toDOM`) when the spec has a separate email
    rendering (`emitDOM`): attributes the view adds for editing alone — a
    `tabindex`, a class, `contenteditable` — are kept beside the authored
    ones, because they are how the editor works, not how the email looks. */
function authoredRender(render: Render, spec: NodeSpec | MarkSpec, viewOf?: Render): Render {
  const defaults = (spec[AUTHORED_STYLE_DEFAULTS_KEY] ?? {}) as Record<string, string>;
  return (subject: Subject, inline?: boolean) => {
    const out = render(subject, inline);
    const markup = authoredMarkupOf(subject);
    if (!markup || typeof out === 'string') return out;
    const current = DOMSerializer.renderSpec(document, out) as {
      dom: globalThis.Node;
      contentDOM?: HTMLElement;
    };
    const currentPath = renderedPath(current);
    if (!currentPath || currentPath.length !== markup.path.length) return out;

    let path = markup.path;
    if (!modelledEqual(subject, markup.parsed)) {
      const baseline = DOMSerializer.renderSpec(
        document,
        render(withParsedAttrs(subject, markup.parsed), inline) as DOMOutputSpec,
      ) as { dom: globalThis.Node; contentDOM?: HTMLElement };
      const baselinePath = renderedPath(baseline);
      if (!baselinePath || baselinePath.length !== path.length) return out;
      path = path.map((element, i) =>
        patchElement(element, baselinePath[i], currentPath[i], defaults),
      );
    }
    if (viewOf) path = withViewAttributes(path, currentPath, viewOf(subject, inline));
    return replacePath(current, currentPath, path);
  };
}

/** Adds the editing-only attributes of the view's rendering (present there,
    absent from the email's) to the authored elements. Never `style`: the
    authored style is what the email shows, so it is what the view shows. */
function withViewAttributes(
  path: AuthoredElement[],
  viewPath: Element[],
  emitted: DOMOutputSpec,
): AuthoredElement[] {
  if (typeof emitted === 'string') return path;
  const emitPath = renderedPath(
    DOMSerializer.renderSpec(document, emitted) as {
      dom: globalThis.Node;
      contentDOM?: HTMLElement;
    },
  );
  if (!emitPath || emitPath.length !== path.length) return path;
  return path.map((element, i) => {
    let result = element;
    for (const { name, value } of Array.from(viewPath[i].attributes)) {
      if (name === 'style' || emitPath[i].hasAttribute(name)) continue;
      if (name === 'class') {
        const authored = authoredAttribute(result, 'class');
        result = withAttribute(result, 'class', authored ? `${authored} ${value}` : value);
      } else if (authoredAttribute(result, name) === null) {
        result = withAttribute(result, name, value);
      }
    }
    return result;
  });
}

/** Swaps every element on the rendered path for its authored counterpart,
    children moved across, so what the rendering put inside stays. */
function replacePath(
  rendered: { dom: globalThis.Node; contentDOM?: HTMLElement },
  renderedElements: Element[],
  authored: AuthoredElement[],
): { dom: HTMLElement; contentDOM?: HTMLElement } {
  let root: HTMLElement | null = null;
  let content: HTMLElement | undefined;
  renderedElements.forEach((old, i) => {
    const { dom } = verbatimElement(authored[i].tag, authored[i].attrs, false);
    while (old.firstChild) dom.appendChild(old.firstChild);
    old.parentNode?.replaceChild(dom, old);
    if (i === 0) root = dom;
    if (old === rendered.contentDOM) content = dom;
  });
  return content ? { dom: root!, contentDOM: content } : { dom: root! };
}

/** One authored element with the difference between two canonical
    renderings (what was parsed → what is now) applied to it. */
function patchElement(
  authored: AuthoredElement,
  baseline: Element,
  current: Element,
  defaults: Record<string, string>,
): AuthoredElement {
  let result: AuthoredElement = {
    tag: baseline.tagName === current.tagName ? authored.tag : current.tagName.toLowerCase(),
    attrs: authored.attrs,
  };
  const names = new Set([
    ...Array.from(baseline.attributes, (a) => a.name),
    ...Array.from(current.attributes, (a) => a.name),
  ]);
  for (const name of names) {
    const before = baseline.getAttribute(name);
    const after = current.getAttribute(name);
    if (before === after) continue;
    if (name === 'style') {
      result = patchStyle(result, before ?? '', after ?? '', defaults);
    } else if (after === null) {
      result = withoutAttribute(result, name);
    } else {
      result = withAttribute(result, name, after);
    }
  }
  return result;
}

function declarations(style: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of splitDeclarations(style)) {
    const property = declarationProperty(part);
    if (property) map.set(property, part.slice(part.indexOf(':') + 1).trim());
  }
  return map;
}

/** Legacy presentational attributes that say what a style declaration says.
    An edit to the declaration lands on the attribute when the authored
    element states it only there (`<p align="left">`), so the two never
    disagree. */
const LEGACY_ATTRIBUTES: Record<string, string> = {
  'text-align': 'align',
  'vertical-align': 'valign',
};

function patchStyle(
  markup: AuthoredElement,
  before: string,
  after: string,
  defaults: Record<string, string>,
): AuthoredElement {
  const was = declarations(before);
  const now = declarations(after);
  let result = markup;
  const set = (property: string, value: string | null) => {
    const legacy = LEGACY_ATTRIBUTES[property];
    const declared = declarations(authoredAttribute(result, 'style') ?? '').has(property);
    if (legacy && !declared && authoredAttribute(result, legacy) !== null) {
      result =
        value === null ? withoutAttribute(result, legacy) : withAttribute(result, legacy, value);
    } else {
      result =
        value === null
          ? withoutStyleDeclaration(result, property)
          : withStyleDeclaration(result, property, value);
    }
  };
  for (const [property, value] of now) {
    if (was.get(property) !== value) set(property, value);
  }
  for (const property of was.keys()) {
    if (now.has(property)) continue;
    set(property, property in defaults ? defaults[property] : null);
  }
  return result;
}

/** The value of one attribute, or null. */
export function authoredAttribute(markup: AuthoredElement, name: string): string | null {
  return markup.attrs.find(([existing]) => existing === name)?.[1] ?? null;
}

/**
 * Sets one CSS declaration in the markup's `style`, touching nothing else:
 * an existing declaration keeps its place and spacing, a new one is appended
 * in the style's own punctuation (`a:b;` stays compact, `a: b;` stays spaced).
 */
export function withStyleDeclaration(
  markup: AuthoredElement,
  property: string,
  value: string,
): AuthoredElement {
  const style = authoredAttribute(markup, 'style');
  let next: string;
  if (style === null || !style.trim()) {
    next = `${property}: ${value};`;
  } else {
    const parts = splitDeclarations(style);
    const index = parts.findIndex((part) => declarationProperty(part) === property);
    if (index >= 0) {
      const part = parts[index];
      const colon = part.indexOf(':');
      const spacing = /^\s*/.exec(part.slice(colon + 1))![0];
      const trailing = /\s*$/.exec(part)![0];
      parts[index] = `${part.slice(0, colon + 1)}${spacing}${value}${trailing}`;
      next = parts.join(';');
    } else {
      const compact = !/:\s/.test(style);
      const declaration = compact ? `${property}:${value};` : `${property}: ${value};`;
      const base = style.trimEnd();
      next = base.endsWith(';')
        ? `${base}${compact ? '' : ' '}${declaration}`
        : `${base}; ${declaration}`;
    }
  }
  return withAttribute(markup, 'style', next);
}

/** Removes one CSS declaration from the markup's `style` (and the attribute
    when nothing is left). */
export function withoutStyleDeclaration(
  markup: AuthoredElement,
  property: string,
): AuthoredElement {
  const style = authoredAttribute(markup, 'style');
  if (style === null) return markup;
  const parts = splitDeclarations(style).filter((part) => declarationProperty(part) !== property);
  const next = parts
    .join(';')
    .replace(/^\s*;\s*/, '')
    .trim();
  return next ? withAttribute(markup, 'style', next) : withoutAttribute(markup, 'style');
}

/** Sets one attribute, in place when present, appended otherwise. */
export function withAttribute(
  markup: AuthoredElement,
  name: string,
  value: string,
): AuthoredElement {
  const exists = markup.attrs.some(([existing]) => existing === name);
  return {
    tag: markup.tag,
    attrs: exists
      ? markup.attrs.map(([existing, old]) => [existing, existing === name ? value : old])
      : [...markup.attrs, [name, value]],
  };
}

export function withoutAttribute(markup: AuthoredElement, name: string): AuthoredElement {
  return { tag: markup.tag, attrs: markup.attrs.filter(([existing]) => existing !== name) };
}

/** The markup of a block split off an authored one: everything inherited
    but the attributes that must stay unique (`id`). */
export function inheritedMarkup(markup: AuthoredMarkup): AuthoredMarkup {
  return {
    parsed: markup.parsed,
    path: markup.path.map((element) => withoutAttribute(element, 'id')),
  };
}

/**
 * For a NodeView that builds its own elements (the table's scroll wrapper,
 * the columns' resize box): the attributes the view should put on the
 * element standing for path entry `index`, or null when the node carries no
 * authored markup — then the view keeps its canonical attributes. Classes the
 * view sets itself are kept alongside the authored ones by
 * {@link applyAuthoredAttributes}.
 */
export function authoredViewAttributes(node: Node, index: number): AttributePairs | null {
  const markup = authoredMarkupOf(node);
  if (!markup) return null;
  const rendered = node.type.spec.toDOM?.(node);
  if (!rendered || typeof rendered === 'string') return null;
  const path = renderedPath(
    DOMSerializer.renderSpec(document, rendered) as {
      dom: globalThis.Node;
      contentDOM?: HTMLElement;
    },
  );
  const element = path?.[index];
  if (!element) return null;
  return Array.from(element.attributes, (attr): [string, string] => [attr.name, attr.value]);
}

/** Puts a node's authored attributes on a view-built element: every other
    attribute goes, except the view's own classes, which stay beside the
    authored ones. No authored markup: nothing changes. */
export function applyAuthoredAttributes(element: HTMLElement, node: Node, index: number): void {
  const attrs = authoredViewAttributes(node, index);
  if (!attrs) return;
  const viewClasses = Array.from(element.classList).filter((name) => name.startsWith('aee-'));
  for (const { name } of Array.from(element.attributes)) element.removeAttribute(name);
  for (const [name, value] of attrs) element.setAttribute(name, value);
  element.classList.add(...viewClasses);
}
