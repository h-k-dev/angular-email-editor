/**
 * The preserving parse — "the source is law".
 *
 * MJML-class tooling emits markup our canonical vocabulary never will: nested
 * layout tables with `align`/`cellpadding`/`bgcolor`, classed `div`s driven by
 * head media queries, Outlook conditional comments, `<input>` hamburger
 * toggles. Repairing all that into canonical form destroys the template, so in
 * `preserve` mode foreign markup is kept **verbatim** — tag and every
 * attribute — through a small family of generic nodes:
 *
 * - {@link HtmlElement} — a block container (`<div>`, `<table>`, `<tr>`, …
 *   holding blocks), `{ tag, attrs }`.
 * - {@link HtmlTextElement} — a block holding inline content (a `<td>` with a
 *   link, a styled `<p>`), same attrs.
 * - {@link HtmlVoid} / {@link HtmlVoidBlock} — void elements (`<img>`,
 *   `<input>`, `<hr>`, …) as inline or block atoms, by context.
 * - {@link HtmlComment} / {@link HtmlCommentInline} — comments, conditional
 *   comments included, as atoms; the serializer emits real comment nodes.
 * - {@link HtmlRaw} — a `<style>` in the body, text kept raw.
 * - {@link HtmlInline} — a mark for phrasing elements (`<span class>`,
 *   `<label>`, …) that no canonical mark claims.
 *
 * Our own canonical shapes keep parsing into their rich nodes, so everything
 * the composer produced stays editable and the golden corpus is an identity in
 * both modes. The discriminator is general, not per node: a canonical node
 * rule claims an element in `preserve` mode only if that node would **re-emit
 * the element's opening tag identically** (same tag, same attributes, styles
 * compared declaration-wise) and its structural children are canonical too.
 * Anything else is foreign and preserved. A preserved subtree stays preserved
 * (a canonical `<tr>` inside a foreign table would have nowhere to live).
 *
 * `repair` mode is unchanged: these rules do not take part, unknown markup
 * dies in the parse as before — the clipboard and the reply/import seeds keep
 * that law.
 *
 * Safety holds in both modes: `script`/`iframe`/… are refused outright, event
 * handler attributes drop, and script URLs drop with the attribute.
 */
import {
  Attrs,
  ContentMatch,
  DOMOutputSpec,
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  Node,
  NodeType,
  ParseRule,
  Schema,
  TagParseRule,
} from 'prosemirror-model';
import { defineMark, defineNode } from './extension';
import { AttributePairs, verbatimElement } from './verbatim';
import { AUTHORED_ATTR, AUTHORED_SPEC_KEY, canonicalRender, renderedPath } from './authored';

export type { AttributePairs } from './verbatim';
export { verbatimElement } from './verbatim';
import { isSafeUrl } from './safe-url';
import { Command } from 'prosemirror-state';
import { ParseMode, RuleScope, ruleForScope, ruleScope, scopeOf } from './parse-mode';
import { defineExtension } from './extension';
import {
  INLINE_TAGS,
  REFUSED_TAGS,
  TABLE_SECTION_TAGS,
  VOID_TAGS,
  isBlockLevel,
} from './html-tags';

/** Placeholder element the comment pre-pass turns DOM comments into:
    ProseMirror's parser never sees comment nodes, elements it does. */
export const COMMENT_TAG = 'aee-comment';
const COMMENT_ATTR = 'data-text';

/** Below every canonical rule (default 50): a preserve rule only ever takes
    what no canonical rule claimed. */
const FALLBACK_PRIORITY = 10;
/** Above every canonical rule: structure that must be decided first. */
const STRUCTURAL_PRIORITY = 100;

const URL_ATTRIBUTES = new Set([
  'action',
  'background',
  'cite',
  'data',
  'formaction',
  'href',
  'longdesc',
  'poster',
  'src',
  'xlink:href',
]);

/** An element's attributes, verbatim and in order — minus what must never be
    emitted: event handlers, `srcdoc`, script URLs, styles with script hooks. */
export function preservedAttributes(element: Element): AttributePairs {
  const pairs: AttributePairs = [];
  for (const { name, value } of Array.from(element.attributes)) {
    if (/^on[a-z]/i.test(name) || name === 'srcdoc') continue;
    if (URL_ATTRIBUTES.has(name) && value.trim() && !isSafeUrl(value)) continue;
    if (name === 'style' && /expression\s*\(|(?:javascript|vbscript)\s*:/i.test(value)) continue;
    // A line break and the indentation after it are formatting, never style:
    // the source pane's formatter breaks a long style that way (and only
    // that way — see `attributeLines`), so dropping them restores the style
    // exactly as written.
    pairs.push([name, name === 'style' ? value.replace(/\r?\n[ \t]*/g, '') : value]);
  }
  return pairs;
}

/** Comment text with its inner indentation dropped: `<!--[if mso]>\n  <xml>`
    and `<!--[if mso]>\n<xml>` are the same comment, and the formatter must
    be free to re-indent inner lines without changing the document. */
export function normalizeCommentText(text: string): string {
  return text.replace(/[ \t]*\r?\n[ \t]*/g, '\n');
}

/** CSS with every line trimmed and re-indented by brace depth — idempotent,
    whitespace-only, so the head styles are a byte-stable fixpoint no matter
    how the source pane indents them. */
export function normalizeCss(css: string): string[] {
  const lines: string[] = [];
  let depth = 0;
  for (const raw of css.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const leadingCloses = /^}+/.exec(line)?.[0].length ?? 0;
    depth = Math.max(0, depth - leadingCloses);
    lines.push('  '.repeat(depth) + line);
    const opens = (line.match(/{/g) ?? []).length;
    const closes = (line.match(/}/g) ?? []).length - leadingCloses;
    depth = Math.max(0, depth + opens - closes);
  }
  return lines;
}

/** Turns every comment under `root` into a placeholder element the parse
    rules can see. Runs on the throwaway DOM a parse builds, never on live DOM. */
export function materializeComments(root: globalThis.Node): void {
  const doc = root.ownerDocument ?? (root as Document);
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_COMMENT);
  const comments: Comment[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    comments.push(node as Comment);
  }
  for (const comment of comments) {
    const placeholder = doc.createElement(COMMENT_TAG);
    placeholder.setAttribute(COMMENT_ATTR, comment.nodeValue ?? '');
    comment.replaceWith(placeholder);
  }
}

/**
 * Drops the edge whitespace inside phrasing elements that are displayed as
 * boxes (`<a style="display: inline-block">` — MJML's navbar links and
 * buttons come as `<a> home </a>`). A box drops the whitespace at the start
 * and end of its own line boxes, so this is rendering-neutral in a client —
 * but the editor view keeps whitespace (`pre-wrap`, as an editor must), where
 * those spaces would take width and wrap a navbar the client keeps on one
 * line. Runs on the throwaway DOM a parse builds.
 */
export function trimInlineBoxes(root: Element): void {
  const boxed = /(?:^|;)\s*display\s*:\s*(?:inline-)?(?:block|table|flex|grid)\b/i;
  for (const element of Array.from(root.querySelectorAll('[style]'))) {
    if (!INLINE_TAGS.has(tagOf(element)) || !boxed.test(element.getAttribute('style') ?? '')) {
      continue;
    }
    const { firstChild, lastChild } = element;
    if (firstChild?.nodeType === globalThis.Node.TEXT_NODE) {
      firstChild.nodeValue = (firstChild.nodeValue ?? '').replace(/^\s+/, '');
    }
    if (lastChild?.nodeType === globalThis.Node.TEXT_NODE) {
      lastChild.nodeValue = (lastChild.nodeValue ?? '').replace(/\s+$/, '');
    }
  }
}

const tagOf = (element: Element): string => element.tagName.toLowerCase();

/**
 * Whether an element takes part in block layout among its siblings: a
 * block-level tag, or a phrasing element wrapping blocks (`<a href><table>`).
 * Images are inline (the composer's image node is an inline atom), so a
 * `td > img` is a cell holding an image, and `td > a > img` a linked image.
 */
export function isBlockish(element: Element): boolean {
  const tag = tagOf(element);
  if (tag === COMMENT_TAG) return false;
  if (INLINE_TAGS.has(tag)) return hasBlockChildren(element);
  return isBlockLevel(tag);
}

/** Whether an element lays its children out as blocks (any block-ish child). */
export function hasBlockChildren(element: Element): boolean {
  for (const child of Array.from(element.children)) {
    if (isBlockish(child)) return true;
  }
  return false;
}

/** Whether an element sits among block siblings — decides inline vs block
    for the atoms (comments, voids) that could be either. */
function inBlockContext(element: Element): boolean {
  const parent = element.parentElement;
  return !parent || hasBlockChildren(parent);
}

/** A tag the generic block nodes may represent. */
function isGenericBlockTag(tag: string): boolean {
  return (
    !INLINE_TAGS.has(tag) &&
    !VOID_TAGS.has(tag) &&
    !REFUSED_TAGS.has(tag) &&
    tag !== 'style' &&
    tag !== COMMENT_TAG
  );
}

// Per-parse bookkeeping — keyed by the throwaway DOM elements a parse walks,
// so nothing outlives them.
/** What each element was parsed as: the node type's name, the preserve
    family's included. An element no rule claimed has no entry. */
const decided = new WeakMap<Element, string>();
/** Elements recognized as a node that cannot hold a comment (`column+`,
    `tableRow+`) in its canonical form: a comment inside one is the node's
    own serializer output (the columns' Outlook ghost table) and is written
    again on the way out. */
const commentless = new WeakSet<Element>();

/** The nearest ancestor that is a node of its own (table sections are walked
    through), or null at the parse root. */
function structuralParent(element: Element): Element | null {
  let parent = element.parentElement;
  while (parent && TABLE_SECTION_TAGS.has(tagOf(parent))) parent = parent.parentElement;
  return parent;
}

/** The name of the node the element's content lands in: the nearest decided
    ancestor's, or null at the parse root (the document). */
function parentDecision(element: Element): string | null {
  for (let parent = structuralParent(element); parent; parent = structuralParent(parent)) {
    const name = decided.get(parent);
    if (name) return name;
  }
  return null;
}

/** Whether the element sits inside markup the preserve family keeps. */
function underPreserved(element: Element): boolean {
  const parent = parentDecision(element);
  return parent === 'htmlElement' || parent === 'htmlTextElement';
}

const claimAs =
  (name: string) =>
  (element: Element): Attrs => {
    decided.set(element, name);
    return { tag: tagOf(element), attrs: preservedAttributes(element) };
  };

const elementAttrs = { tag: {}, attrs: { default: [] as AttributePairs } };
const renderElement = (node: Node): DOMOutputSpec =>
  verbatimElement(node.attrs['tag'], node.attrs['attrs'] as AttributePairs, true);
const renderVoid = (node: Node): DOMOutputSpec =>
  verbatimElement(node.attrs['tag'], node.attrs['attrs'] as AttributePairs, false);

/** A comment on its way out: the serializer cannot emit comment nodes from a
    spec (only elements), so it emits this placeholder and `serializeToHTML`
    turns it into a real comment before reading the HTML back. */
const renderComment = (node: Node): DOMOutputSpec => [
  COMMENT_TAG,
  { [COMMENT_ATTR]: node.attrs['text'] },
];

/** Replaces emitted comment placeholders under `root` with comment nodes. */
export function realizeComments(root: Element): void {
  for (const placeholder of Array.from(root.querySelectorAll(COMMENT_TAG))) {
    placeholder.replaceWith(
      root.ownerDocument.createComment(placeholder.getAttribute(COMMENT_ATTR) ?? ''),
    );
  }
}

const preserveRule = (rule: TagParseRule): TagParseRule =>
  ruleForScope('authored', { priority: FALLBACK_PRIORITY, ...rule });

/** A foreign block container — anything holding block-level children. */
export const HtmlElement = defineNode({
  name: 'htmlElement',
  spec: {
    authoredMarkup: false,
    content: 'block*',
    group: 'block',
    attrs: elementAttrs,
    parseDOM: [
      // A phrasing element wrapping blocks (`<a href><table>…`, `<span><div>`)
      // cannot be a mark — it is a container, decided before any mark rule.
      preserveRule({
        tag: '*',
        priority: STRUCTURAL_PRIORITY,
        getAttrs: (element) => {
          const tag = tagOf(element);
          if (!INLINE_TAGS.has(tag) || REFUSED_TAGS.has(tag)) return false;
          return hasBlockChildren(element) ? claimAs('htmlElement')(element) : false;
        },
      }),
      preserveRule({
        tag: '*',
        getAttrs: (element) => {
          const tag = tagOf(element);
          if (!isGenericBlockTag(tag) || !hasBlockChildren(element)) return false;
          if (TABLE_SECTION_TAGS.has(tag) && !underPreserved(element)) return false;
          return claimAs('htmlElement')(element);
        },
      }),
    ],
    toDOM: renderElement,
  },
});

/** A structural block holding inline content — a `<td>` with a link (MJML's
    button cell), a `<center>` or `<label>`-free text container. Text lines
    (`div`, `p`) and headings are the composer's own nodes instead; see
    `authored.ts`. Enter inserts a line break here (see {@link AuthoredEnter})
    — splitting a table cell would add a cell. */
export const HtmlTextElement = defineNode({
  name: 'htmlTextElement',
  spec: {
    authoredMarkup: false,
    content: 'inline*',
    group: 'block',
    attrs: elementAttrs,
    parseDOM: [
      preserveRule({
        tag: '*',
        getAttrs: (element) => {
          const tag = tagOf(element);
          if (!isGenericBlockTag(tag) || hasBlockChildren(element)) return false;
          if (TABLE_SECTION_TAGS.has(tag) && !underPreserved(element)) return false;
          return claimAs('htmlTextElement')(element);
        },
      }),
    ],
    toDOM: renderElement,
  },
});

const voidAttrs = (element: Element, inline: boolean): Attrs | false => {
  const tag = tagOf(element);
  if (!VOID_TAGS.has(tag) || REFUSED_TAGS.has(tag)) return false;
  if (inBlockContext(element) === inline) return false;
  return claimAs(inline ? 'htmlVoid' : 'htmlVoidBlock')(element);
};

/** A foreign void element among inline content (`<img>` in a cell, `<input>`). */
export const HtmlVoid = defineNode({
  name: 'htmlVoid',
  spec: {
    authoredMarkup: false,
    inline: true,
    group: 'inline',
    atom: true,
    attrs: elementAttrs,
    parseDOM: [preserveRule({ tag: '*', getAttrs: (element) => voidAttrs(element, true) })],
    toDOM: renderVoid,
  },
});

/** A foreign void element among blocks (`<hr class>`, an `<input>` between divs). */
export const HtmlVoidBlock = defineNode({
  name: 'htmlVoidBlock',
  spec: {
    authoredMarkup: false,
    group: 'block',
    atom: true,
    attrs: elementAttrs,
    parseDOM: [preserveRule({ tag: '*', getAttrs: (element) => voidAttrs(element, false) })],
    toDOM: renderVoid,
  },
});

const commentAttrs = (element: Element, inline: boolean): Attrs | false => {
  const parent = structuralParent(element);
  if (parent && commentless.has(parent)) return false;
  return inBlockContext(element) === inline
    ? false
    : { text: normalizeCommentText(element.getAttribute(COMMENT_ATTR) ?? '') };
};

/** A comment between blocks — MJML's Outlook conditionals live here. Hidden
    in the editor (a browser renders nothing for it either); the serializer
    emits a real comment node. */
export const HtmlComment = defineNode({
  name: 'htmlComment',
  spec: {
    authoredMarkup: false,
    group: 'block',
    atom: true,
    selectable: false,
    attrs: { text: { default: '' } },
    parseDOM: [preserveRule({ tag: COMMENT_TAG, getAttrs: (el) => commentAttrs(el, false) })],
    toDOM: () => ['div', { class: 'aee-comment', hidden: '' }],
    emitDOM: renderComment,
  },
});

/** A comment among inline content. */
export const HtmlCommentInline = defineNode({
  name: 'htmlCommentInline',
  spec: {
    authoredMarkup: false,
    inline: true,
    group: 'inline',
    atom: true,
    selectable: false,
    attrs: { text: { default: '' } },
    parseDOM: [preserveRule({ tag: COMMENT_TAG, getAttrs: (el) => commentAttrs(el, true) })],
    toDOM: () => ['span', { class: 'aee-comment', hidden: '' }],
    emitDOM: renderComment,
  },
});

/**
 * A `<style>` in the body, text kept raw (whitespace-normalized). Hidden in
 * the editor — a live `<style>` inside the editable DOM would restyle the host
 * app; the `DocumentStyles` extension applies it scoped, like the head's.
 * Also carries the refusals: executable content is never parsed, in any mode,
 * and a body `<style>` dies in repair mode (its text would leak otherwise).
 */
export const HtmlRaw = defineNode({
  name: 'htmlRaw',
  spec: {
    authoredMarkup: false,
    group: 'block',
    atom: true,
    selectable: false,
    attrs: { attrs: { default: [] as AttributePairs }, text: { default: '' } },
    parseDOM: [
      ...[...REFUSED_TAGS].map((tag): TagParseRule => ({ tag, ignore: true })),
      ruleForScope('repair', { tag: 'style', ignore: true }),
      preserveRule({
        tag: 'style',
        getAttrs: (element) => ({
          attrs: preservedAttributes(element),
          text: normalizeCss(element.textContent ?? '').join('\n'),
        }),
      }),
    ],
    toDOM: () => ['span', { class: 'aee-raw', hidden: '' }],
    emitDOM: (node: Node): DOMOutputSpec => {
      const { dom } = verbatimElement('style', node.attrs['attrs'] as AttributePairs, false);
      dom.textContent = node.attrs['text'];
      return { dom };
    },
  },
});

/** A phrasing element no canonical mark claims (`<span class="…">`,
    `<label>`, `<font face>`), kept verbatim. Instances nest freely
    (`excludes: ''`), outermost first, so `<a><span>…` survives as authored. */
export const HtmlInline = defineMark({
  name: 'htmlInline',
  spec: {
    authoredMarkup: false,
    attrs: elementAttrs,
    excludes: '',
    parseDOM: [
      preserveRule({
        tag: '*',
        getAttrs: (element) => {
          const tag = tagOf(element);
          if (!INLINE_TAGS.has(tag) || hasBlockChildren(element)) return false;
          return { tag, attrs: preservedAttributes(element) };
        },
      }),
    ],
    toDOM: (mark) =>
      verbatimElement(mark.attrs['tag'], mark.attrs['attrs'] as AttributePairs, true),
  },
});

/**
 * Enter inside a structural text block ({@link HtmlTextElement}) inserts a
 * line break instead of splitting it: splitting a `<td>` adds a table cell,
 * splitting a `<center>` duplicates a container. Must sit before the kit's
 * `SplitKeepingMarks`, whose split would otherwise claim Enter.
 */
export const AuthoredEnter = defineExtension({
  name: 'authoredEnter',
  keymap: ({ schema }) => {
    const breakLine: Command = (state, dispatch) => {
      const textElement = schema.nodes[HtmlTextElement.name];
      const hardBreak = schema.nodes['hardBreak'];
      if (!textElement || !hardBreak || state.selection.$from.parent.type !== textElement) {
        return false;
      }
      dispatch?.(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
      return true;
    };
    return { Enter: breakLine };
  },
});

/** The whole family, in schema order: block nodes, then inline atoms, then
    the mark. Both kits include it; the mode decides whether it takes part. */
export const preserveExtensions = [
  HtmlElement,
  HtmlTextElement,
  HtmlVoidBlock,
  HtmlVoid,
  HtmlComment,
  HtmlCommentInline,
  HtmlRaw,
  HtmlInline,
];

// --- The mode-aware parser ---------------------------------------------------

/** Style declarations as a sorted, whitespace-normalized list, so `a:b;c:d`
    and `c: d; a: b;` compare equal — order and spacing never render. */
function normalizeStyle(style: string): string {
  return style
    .split(';')
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colon = declaration.indexOf(':');
      if (colon < 0) return declaration.toLowerCase();
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration
        .slice(colon + 1)
        .trim()
        .replace(/\s+/g, ' ');
      return `${property}: ${value}`;
    })
    .sort()
    .join('; ');
}

/** Same tag, same attribute set, same values (styles declaration-wise). */
function sameOpeningTag(a: Element, b: Element): boolean {
  if (a.tagName !== b.tagName || a.attributes.length !== b.attributes.length) return false;
  for (const { name, value } of Array.from(a.attributes)) {
    const other = b.getAttribute(name);
    if (other === null) return false;
    if (name === 'style' ? normalizeStyle(value) !== normalizeStyle(other) : value !== other) {
      return false;
    }
  }
  return true;
}

/** Element children that take part in block structure, table sections
    walked through. Phrasing elements and comments are marks/inline atoms and
    never affect whether a parent is canonical. */
function* structuralChildren(element: Element): Iterable<Element> {
  for (const child of Array.from(element.children)) {
    const tag = tagOf(child);
    if (TABLE_SECTION_TAGS.has(tag)) yield* structuralChildren(child);
    else if (!INLINE_TAGS.has(tag) && tag !== COMMENT_TAG) yield child;
  }
}

/** Every node type a node of `type` may hold directly, anywhere in its
    content — what the parse may put inside it without inventing a wrapper. */
const childTypesCache = new WeakMap<NodeType, Set<NodeType>>();
function childTypes(type: NodeType): Set<NodeType> {
  let types = childTypesCache.get(type);
  if (types) return types;
  types = new Set<NodeType>();
  const seen = new Set<ContentMatch>();
  const visit = (match: ContentMatch) => {
    if (seen.has(match)) return;
    seen.add(match);
    for (let i = 0; i < match.edgeCount; i++) {
      const edge = match.edge(i);
      types!.add(edge.type);
      visit(edge.next);
    }
  };
  visit(type.contentMatch);
  childTypesCache.set(type, types);
  return types;
}

/**
 * The authored elements from `element` down to where its content is read,
 * following the canonical rendering's own path (`expected`, tag by tag): the
 * rule's `contentElement` when it names one, else the only child of the
 * expected tag at each level — the `<tbody>` a browser inserts into every
 * `<table>`, which the parser walks through the same way. Null when the
 * authored markup does not have that shape.
 */
function authoredElements(
  element: HTMLElement,
  rule: TagParseRule,
  expected: Element[],
): Element[] | null {
  if (expected.length === 1) return [element];
  const selector = rule.contentElement;
  if (selector) {
    const content =
      typeof selector === 'string'
        ? element.querySelector(selector)
        : typeof selector === 'function'
          ? selector(element)
          : selector;
    if (!(content instanceof Element)) return null;
    const path: Element[] = [];
    for (let el: Element | null = content; el; el = el.parentElement) {
      path.unshift(el);
      if (el === element) return path;
    }
    return null;
  }
  const path: Element[] = [element];
  for (let i = 1; i < expected.length; i++) {
    const tag = expected[i].tagName;
    const matches = Array.from(path[i - 1].children).filter((child) => child.tagName === tag);
    if (matches.length !== 1) return null;
    path.push(matches[0]);
  }
  return path;
}

/** Whether an element holds anything besides `next` — text, or other
    elements (comments included). */
function hasSiblingsOf(element: Element, next: Element): boolean {
  for (const child of Array.from(element.childNodes)) {
    if (child === next) continue;
    if (child.nodeType === globalThis.Node.TEXT_NODE && !(child.nodeValue ?? '').trim()) continue;
    return true;
  }
  return false;
}

/** Whether an element's content holds a comment where the node keeps none. */
function holdsCommentChild(element: Element): boolean {
  for (const child of Array.from(element.children)) {
    const tag = tagOf(child);
    if (tag === COMMENT_TAG) return true;
    if (TABLE_SECTION_TAGS.has(tag) && holdsCommentChild(child)) return true;
  }
  return false;
}

/** Same tag and attributes, element by element. */
function samePath(a: Element[], b: Element[]): boolean {
  return a.length === b.length && a.every((element, i) => sameOpeningTag(element, b[i]));
}

type TypeOf = (element: Element, parent: NodeType) => NodeType | null;

/**
 * A node rule for the authored scope: the node **recognizes** whatever
 * markup its own rule accepts, and keeps that markup as authored (the `html`
 * overlay, see `authored.ts`) wherever it is not exactly the node's own
 * canonical rendering. Recognition is refused — and the preserve family
 * keeps the element verbatim instead — whenever taking it would change the
 * markup's *structure*:
 *
 * - the node could not stand where the element stands (no wrapper is ever
 *   invented: a `<tr>` outside a table, a column outside a columns block);
 * - the authored elements down to the content are not the ones the node
 *   renders (a section's band without the inner `<div>` it writes), or carry
 *   anything beside that path;
 * - the content would not fit: a textblock laying out blocks, or a node
 *   that holds only certain children (`tableRow+`, `column+`, `inline*`)
 *   given ones it cannot hold, in order;
 * - it holds comments the node has no place for (MJML's conditionals in a
 *   columns block) — only the node's own canonical rendering may, because
 *   it writes them itself.
 */
function recognize(schema: Schema, rule: TagParseRule, typeOf: TypeOf): TagParseRule {
  const type = schema.nodes[rule.node!];
  const comment = schema.nodes[HtmlComment.name];
  const foreignBlock = schema.nodes[HtmlElement.name];
  const leaf = type.isLeaf;
  const holdsComments = leaf || type.inlineContent || !comment || childTypes(type).has(comment);
  const holdsForeignBlocks = !!foreignBlock && childTypes(type).has(foreignBlock);
  const memo = new WeakMap<Element, Map<NodeType | null, Attrs | false | null>>();

  const decide = (element: HTMLElement, parent: NodeType): Attrs | false | null => {
    const own = rule.getAttrs ? rule.getAttrs(element) : null;
    if (own === false) return false;
    // Inline nodes (an image, a button) stand in whatever line holds them —
    // among blocks, the parser gives them one, as it does loose text.
    if (!type.isInline && !childTypes(parent).has(type)) return false;
    if (type.isTextblock && hasBlockChildren(element)) return false;

    const attrs: Record<string, unknown> = { ...(rule.attrs ?? {}), ...(own ?? {}) };
    delete attrs[AUTHORED_ATTR];
    let rendered;
    try {
      rendered = canonicalRender(type.create({ ...attrs, [AUTHORED_ATTR]: null }), true);
    } catch {
      return false;
    }
    const canonicalPath = rendered && renderedPath(rendered);
    const path = canonicalPath && authoredElements(element, rule, canonicalPath);
    if (!canonicalPath || !path || path.length !== canonicalPath.length) return false;
    for (let i = 1; i < path.length; i++) {
      if (path[i].tagName !== canonicalPath[i].tagName) return false;
    }
    const exact = samePath(path, canonicalPath);
    if (!exact) {
      for (let i = 0; i < path.length - 1; i++) {
        if (hasSiblingsOf(path[i], path[i + 1])) return false;
      }
    }

    const content = path[path.length - 1];
    if (!leaf && !type.inlineContent && !holdsForeignBlocks) {
      let match = type.contentMatch;
      for (const child of structuralChildren(content)) {
        const childType = typeOf(child, type);
        const next = childType && match.matchType(childType);
        if (!next) return false;
        match = next;
      }
    }
    if (!holdsComments && holdsCommentChild(content)) {
      if (!exact) return false;
      commentless.add(content);
      commentless.add(element);
    }

    const html = exact
      ? null
      : {
          path: path.map((el) => ({ tag: tagOf(el), attrs: preservedAttributes(el) })),
          parsed: attrs,
        };
    return { ...attrs, [AUTHORED_ATTR]: html };
  };

  const decideMemo = (element: HTMLElement, parent: NodeType): Attrs | false | null => {
    let byParent = memo.get(element);
    if (!byParent) memo.set(element, (byParent = new Map()));
    if (!byParent.has(parent)) byParent.set(parent, decide(element, parent));
    return byParent.get(parent)!;
  };

  return {
    ...rule,
    getAttrs: (element) => {
      const parentName = parentDecision(element);
      const parent = parentName ? schema.nodes[parentName] : schema.topNodeType;
      const result = decideMemo(element, parent);
      if (result !== false) decided.set(element, type.name);
      return result;
    },
    // The same decision, asked by a parent about a child it would hold.
    [PROBE_KEY]: (element: HTMLElement, parent: NodeType) => decideMemo(element, parent),
  } as TagParseRule;
}

const PROBE_KEY = 'aeeProbe';
type TypeOfProbe = (element: HTMLElement, parent: NodeType) => Attrs | false | null;

/**
 * A mark rule for the authored scope: the mark keeps the element as
 * authored (`<b class="x">`, a link's own `style`) wherever it is not
 * exactly the mark's canonical rendering.
 */
function recognizeMark(schema: Schema, rule: TagParseRule): TagParseRule {
  const type = schema.marks[rule.mark!];
  if (type.spec[AUTHORED_SPEC_KEY] === false || !type.spec.attrs?.[AUTHORED_ATTR]) return rule;
  return {
    ...rule,
    getAttrs: (element) => {
      const own = rule.getAttrs ? rule.getAttrs(element) : null;
      if (own === false) return false;
      const attrs: Record<string, unknown> = { ...(rule.attrs ?? {}), ...(own ?? {}) };
      delete attrs[AUTHORED_ATTR];
      let rendered;
      try {
        rendered = canonicalRender(type.create({ ...attrs, [AUTHORED_ATTR]: null }), true);
      } catch {
        return false;
      }
      const exact = rendered?.dom instanceof Element && sameOpeningTag(rendered.dom, element);
      const html = exact
        ? null
        : { path: [{ tag: tagOf(element), attrs: preservedAttributes(element) }], parsed: attrs };
      return { ...attrs, [AUTHORED_ATTR]: html };
    },
  };
}

/** Every parse rule of the schema, marks before nodes, sorted by priority
    (stable), each tagged with the node or mark it produces — what ProseMirror
    itself builds for `DOMParser.fromSchema`, rebuilt here from the public
    specs so it can be filtered and wrapped per mode. */
function schemaParseRules(schema: Schema): ParseRule[] {
  const rules: ParseRule[] = [];
  const priorityOf = (rule: ParseRule) => rule.priority ?? 50;
  const insert = (rule: ParseRule) => {
    let index = 0;
    while (index < rules.length && priorityOf(rules[index]) >= priorityOf(rule)) index++;
    rules.splice(index, 0, rule);
  };
  const isProducer = (rule: ParseRule) =>
    'mark' in rule || 'node' in rule || rule.ignore || 'clearMark' in rule;
  for (const [name, type] of Object.entries(schema.marks)) {
    for (const rule of type.spec.parseDOM ?? []) {
      insert(isProducer(rule) ? { ...rule } : { ...rule, mark: name });
    }
  }
  for (const [name, type] of Object.entries(schema.nodes)) {
    for (const rule of type.spec.parseDOM ?? []) {
      insert(isProducer(rule) ? { ...rule } : { ...rule, node: name });
    }
  }
  return rules;
}

const parserCache = new WeakMap<Schema, Partial<Record<RuleScope, ProseMirrorDOMParser>>>();

/**
 * The schema's parser for a mode. `repair` is the plain schema parser minus
 * the authored rules. `email` and `preserve` share one parser (they differ
 * only in the vocabulary filter applied before it runs): it drops style
 * rules (they would mark authored text up — `font-weight: bold` on an
 * authored `<div>` must stay a style, not become a `<strong>`), lets the
 * nodes that carry authored markup claim theirs, strictifies every other
 * canonical node rule, and lets the preserve family take the rest.
 */
export function createDOMParser(schema: Schema, mode: ParseMode): ProseMirrorDOMParser {
  const scope = scopeOf(mode);
  let byScope = parserCache.get(schema);
  if (!byScope) parserCache.set(schema, (byScope = {}));
  const cached = byScope[scope];
  if (cached) return cached;

  const all = schemaParseRules(schema).filter((rule) => {
    const restricted = ruleScope(rule);
    if (restricted && restricted !== scope) return false;
    return scope === 'repair' || 'tag' in rule;
  });

  let rules: ParseRule[] = all;
  if (scope === 'authored' && schema.nodes[HtmlElement.name]) {
    const recognized: TagParseRule[] = [];
    const typeOf: TypeOf = (element, parent) => {
      for (const rule of recognized) {
        if (!element.matches(rule.tag!)) continue;
        const probe = (rule as unknown as Record<string, TypeOfProbe>)[PROBE_KEY];
        if (probe(element as HTMLElement, parent) !== false) return schema.nodes[rule.node!];
      }
      return null;
    };
    rules = all.map((rule) => {
      const tagRule = rule as TagParseRule;
      // The preserve family is the fallback, verbatim by construction.
      if (ruleScope(rule)) return rule;
      if (tagRule.mark && tagRule.tag) return recognizeMark(schema, tagRule);
      if (!tagRule.node || !tagRule.tag || tagRule.ignore) return rule;
      const made = recognize(schema, tagRule, typeOf);
      recognized.push(made);
      return made;
    });
  }

  const parser = new ProseMirrorDOMParser(schema, rules);
  byScope[scope] = parser;
  return parser;
}
