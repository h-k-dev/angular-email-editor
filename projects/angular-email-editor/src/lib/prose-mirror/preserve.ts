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

/** Attributes as an ordered list of pairs — JSON-plain, so ProseMirror can
    compare node attrs, and ordered, so the round trip keeps authored order. */
export type AttributePairs = [string, string][];

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
const preserved = new WeakSet<Element>();
const canonical = new WeakSet<Element>();
/** Canonical elements whose node cannot hold a comment (`column+`,
    `tableRow+`): a comment inside one is the node's own serializer output
    (the columns' Outlook ghost table) and is written again on the way out. */
const commentless = new WeakSet<Element>();

/** The nearest ancestor that is a node of its own (table sections are walked
    through), or null at the parse root. */
function structuralParent(element: Element): Element | null {
  let parent = element.parentElement;
  while (parent && TABLE_SECTION_TAGS.has(tagOf(parent))) parent = parent.parentElement;
  return parent;
}

/** Whether every ancestor decided so far is canonical — a canonical node
    inside a preserved subtree would have nowhere to live. */
function canonicalContext(element: Element): boolean {
  for (let parent = structuralParent(element); parent; parent = structuralParent(parent)) {
    if (preserved.has(parent)) return false;
    if (canonical.has(parent)) return true;
  }
  return true;
}

function underPreserved(element: Element): boolean {
  return !canonicalContext(element);
}

const claim = (element: Element): Attrs => {
  preserved.add(element);
  return { tag: tagOf(element), attrs: preservedAttributes(element) };
};

/**
 * A DOM element with its attributes set **verbatim**. Array output specs run
 * `style` through the CSSOM (`style.cssText = …`), which reformats it and
 * drops every declaration the browser does not know — MJML's `mso-*` hints
 * for Outlook would vanish. Preserved markup therefore builds its own
 * elements; `setAttribute` keeps the string as authored.
 */
export function verbatimElement(
  tag: string,
  attrs: Iterable<[string, string | null | undefined]>,
  content: boolean,
): { dom: HTMLElement; contentDOM?: HTMLElement } {
  const dom = document.createElement(tag);
  for (const [name, value] of attrs) {
    if (value != null) dom.setAttribute(name, value);
  }
  return content ? { dom, contentDOM: dom } : { dom };
}

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
          return hasBlockChildren(element) ? claim(element) : false;
        },
      }),
      preserveRule({
        tag: '*',
        getAttrs: (element) => {
          const tag = tagOf(element);
          if (!isGenericBlockTag(tag) || !hasBlockChildren(element)) return false;
          if (TABLE_SECTION_TAGS.has(tag) && !underPreserved(element)) return false;
          return claim(element);
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
          return claim(element);
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
  return claim(element);
};

/** A foreign void element among inline content (`<img>` in a cell, `<input>`). */
export const HtmlVoid = defineNode({
  name: 'htmlVoid',
  spec: {
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

/** Whether the node type, given these attrs, would emit `element`'s opening
    tag unchanged — the general "would the round trip rewrite this?" test. */
function emitsIdentically(type: NodeType, attrs: Attrs, element: Element): boolean {
  let node: Node;
  try {
    node = type.create(attrs);
  } catch {
    return false;
  }
  const render =
    (type.spec['emitDOM'] as ((node: Node) => DOMOutputSpec) | undefined) ?? type.spec.toDOM;
  if (!render) return false;
  const { dom } = DOMSerializer.renderSpec(document, render(node));
  return dom instanceof Element && sameOpeningTag(dom, element);
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

type CanonicalTypeOf = (element: Element) => NodeType | null;

/**
 * A rule for a node that carries authored markup (`html` attr — paragraph,
 * heading, image): it claims the element whatever its attributes, and keeps
 * them verbatim unless they are exactly what the node emits on its own
 * (then `html` stays `null`, and the output is canonical). Textblocks decline
 * elements laying out blocks; a block atom declines an element that sits
 * inside a line of text.
 */
function passthrough(schema: Schema, rule: TagParseRule): TagParseRule {
  const type = schema.nodes[rule.node!];
  const memo = new WeakMap<Element, Attrs | false>();

  const decide = (element: HTMLElement): Attrs | false => {
    const own = rule.getAttrs ? rule.getAttrs(element) : null;
    if (own === false) return false;
    if (type.isTextblock && hasBlockChildren(element)) return false;
    if (type.isBlock && !type.isTextblock && !isBlockish(element)) return false;
    const attrs = { ...(rule.attrs ?? {}), ...(own ?? {}), html: null };
    if (emitsIdentically(type, attrs, element)) return attrs;
    return { ...attrs, html: { tag: tagOf(element), attrs: preservedAttributes(element) } };
  };

  return {
    ...rule,
    getAttrs: (element) => {
      if (memo.has(element)) return memo.get(element)!;
      const result = decide(element);
      memo.set(element, result);
      return result;
    },
  };
}

/**
 * A canonical node rule, made strict for the authored scope: it claims an element
 * only when the node would re-emit it identically, its ancestors are
 * canonical, and — for content expressions that cannot hold a foreign block
 * (`tableRow+`, `column+`, `inline*`, …) — its structural children are
 * canonical and fit its content expression in sequence.
 */
function strictify(
  schema: Schema,
  rule: TagParseRule,
  foreignBlock: NodeType,
  canonicalTypeOf: CanonicalTypeOf,
): TagParseRule {
  const type = schema.nodes[rule.node!];
  const acceptsForeignBlocks = type.contentMatch.matchType(foreignBlock) !== null;
  const comment = schema.nodes[HtmlComment.name];
  const holdsComments =
    type.inlineContent || !comment || type.contentMatch.matchType(comment) !== null;
  const memo = new WeakMap<Element, Attrs | false | null>();

  const decide = (element: HTMLElement): Attrs | false | null => {
    const own = rule.getAttrs ? rule.getAttrs(element) : null;
    if (own === false) return false;
    const attrs = { ...(rule.attrs ?? {}), ...(own ?? {}) };
    // Context matters for structure only: an inline node (a `<br>`) lives in
    // any line, authored or not.
    if (!type.isInline && !canonicalContext(element)) return false;
    if (!emitsIdentically(type, attrs, element)) return false;

    if (!acceptsForeignBlocks) {
      let match = type.contentMatch;
      for (const child of structuralChildren(element)) {
        const childType = canonicalTypeOf(child);
        const next = childType && match.matchType(childType);
        if (!next) return false;
        match = next;
      }
    }
    canonical.add(element);
    if (!holdsComments) commentless.add(element);
    return own;
  };

  return {
    ...rule,
    getAttrs: (element) => {
      if (memo.has(element)) return memo.get(element)!;
      const result = decide(element);
      memo.set(element, result);
      return result;
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
  const foreignBlock = schema.nodes[HtmlElement.name];
  if (scope === 'authored' && foreignBlock) {
    const strict: TagParseRule[] = [];
    const canonicalTypeOf: CanonicalTypeOf = (element) => {
      for (const rule of strict) {
        if (!element.matches(rule.tag)) continue;
        if (rule.getAttrs!(element as HTMLElement) !== false) return schema.nodes[rule.node!];
      }
      return null;
    };
    rules = all.map((rule) => {
      const tagRule = rule as TagParseRule;
      // Only canonical node rules change: marks stay lenient (a `<b class>`
      // is still bold), and the preserve family is the fallback.
      if (!tagRule.node || ruleScope(rule)) return rule;
      const made = schema.nodes[tagRule.node].spec.attrs?.['html']
        ? passthrough(schema, tagRule)
        : strictify(schema, tagRule, foreignBlock, canonicalTypeOf);
      strict.push(made);
      return made;
    });
  }

  const parser = new ProseMirrorDOMParser(schema, rules);
  byScope[scope] = parser;
  return parser;
}
