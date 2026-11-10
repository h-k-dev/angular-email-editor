import { Node } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { dawnDarkDeclarationsOf } from '@h-k-dev/dawn';
import { defineExtension } from '../extension';
import { DocumentEnvelope } from '../envelope';
import { AttributePairs } from '../preserve';
import { splitDeclarations } from '../email-vocabulary';
import { DARK_PAPER_SCOPE } from './dark-rendering';

/** Editor root class while the document carries an envelope — the host's
    hook for rendering a template like a client would (browser typography
    rather than the composer's), see the example app's styles. */
export const DOCUMENT_CLASS = 'aee-document';

export interface DocumentStylesOptions {
  /** A selector the editor's root (`.aee-editor`) matches while its paper is
      dark — the one `createDarkRendering` takes as `scope`, and the same
      default: dark under any element that says `data-color-scheme="dark"`.
      It is what a document's own `prefers-color-scheme` rules follow here,
      whatever the viewer's browser prefers. */
  readonly darkScope?: string;
}

let instances = 0;

/**
 * Applies a preserved document's stylesheets to the editor view, so the
 * visual pane renders an MJML-class template exactly as the preview does:
 * the head's `<style>` blocks (media queries included — that is what makes
 * MJML columns responsive), its `<link rel="stylesheet">`s, and any `<style>`
 * in the body. Everything is wrapped in `@scope (.<this editor>) { … }`, so
 * a template's `table, td { … }` or `p { margin: 13px 0 }` reaches this
 * editor's content and nothing else on the page. `@import`s are hoisted
 * ahead of the scope block, where CSS requires them.
 *
 * **The body is the editor's root** — the closest thing the editable view
 * has to one. Its own inline style and `bgcolor` land there as an inline
 * style; a rule of the document's that is for its body (`body { … }`,
 * `body.page`, `[dir="rtl"] body`) is read against the body the document
 * has and, where it matches, sent to the root ({@link scopedDocumentCss}),
 * over the host's own surface for the root, under the inline style, as a
 * rule is. A rule for what is in the body (`body td`) is read the same way.
 *
 * All but its box: the root's margin and padding are the host's layout (its
 * gutters, a page layout's column, the room under the last line), and a
 * template's `padding: 0` would beat every rule of it. The body's `margin*`
 * and `padding*` go out as custom properties instead
 * ({@link BODY_BOX_PREFIX}: `--aee-body-padding`, `--aee-body-margin-top`,
 * …), for a host that wants to draw them; a rule's `width`, `height` and
 * the rest of a box's geometry are left out.
 *
 * **Dark is the paper's.** A document's `@media (prefers-color-scheme:
 * dark)` rules apply while the paper is dark ({@link
 * DocumentStylesOptions.darkScope}) and its `light` ones while it is not —
 * never by what the viewer's browser prefers, which says nothing of the
 * paper. And on dark paper the colours a body rule paints are drawn dark by
 * Dawn, as the editor draws every inline colour (`createDarkRendering`);
 * a document's own dark rule, written after, still has the last word.
 *
 * Behaviour only: the style element sits beside the editor's DOM and is
 * removed with it. No pixels of its own.
 */
export function createDocumentStyles(options: DocumentStylesOptions = {}) {
  const darkScope = options.darkScope ?? DARK_PAPER_SCOPE;
  return defineExtension({
    name: 'documentStyles',
    plugins: () => {
      const scope = `aee-doc-${++instances}`;
      return [
        new Plugin({
          key: new PluginKey('documentStyles'),
          props: {
            attributes: (state) => rootAttributes(scope, state.doc),
          },
          view: (view) => new DocumentStylesView(view, scope, darkScope),
        }),
      ];
    },
  });
}

/** {@link createDocumentStyles} as the kits carry it: dark under any element
    that says `data-color-scheme="dark"`. */
export const DocumentStyles = createDocumentStyles();

function envelopeOf(doc: Node): DocumentEnvelope | null {
  return (doc.attrs['envelope'] as DocumentEnvelope | null | undefined) ?? null;
}

function rootAttributes(scope: string, doc: Node): Record<string, string> {
  const envelope = envelopeOf(doc);
  const attrs: Record<string, string> = {
    class: envelope ? `${scope} ${DOCUMENT_CLASS}` : scope,
  };
  const style = envelope ? bodyStyle(envelope.body) : '';
  if (style) attrs['style'] = style;
  return attrs;
}

/** The prefix the body's box takes on the editor root: its `padding` is
    `--aee-body-padding`, its `margin-top` `--aee-body-margin-top`. */
export const BODY_BOX_PREFIX = '--aee-body-';

/** A margin or padding, any side — the root's box, the host's to set. */
const BOX_PROPERTY = /^(?:margin|padding)(?:-[a-z-]+)?$/;

/** The rest of a box's geometry: a body's in a client's window, never the
    editor root's in its host — `height: 100%` alone collapses an editor of a
    fixed height. Left out of a body rule sent to the root. */
const GEOMETRY_PROPERTY =
  /^(?:(?:min-|max-)?(?:width|height)|(?:min-|max-)?(?:inline|block)-size|display|position|inset(?:-[a-z-]+)?|top|right|bottom|left|float|clear|overflow(?:-[a-z]+)?|box-sizing|transform|zoom)$/;

/** One declaration as the root may take it: the body's box renamed
    ({@link BODY_BOX_PREFIX}), anything else as written — null for none. */
function rootDeclaration(declaration: string): string | null {
  const colon = declaration.indexOf(':');
  if (colon < 0) return null;
  const property = declaration.slice(0, colon).trim();
  const rest = declaration.slice(colon + 1).trim();
  if (!property || !rest) return null;
  // Only the box is renamed: a template's own custom property keeps its
  // case, which is its name.
  const box = property.toLowerCase();
  return BOX_PROPERTY.test(box) ? `${BODY_BOX_PREFIX}${box}: ${rest}` : `${property}: ${rest}`;
}

/** The body's inline style plus its legacy `bgcolor`, as one declaration
    list — its box as custom properties (see {@link createDocumentStyles}). */
function bodyStyle(body: AttributePairs): string {
  const declarations: string[] = [];
  for (const [name, value] of body) {
    if (name === 'style') {
      for (const declaration of splitDeclarations(value)) {
        const own = rootDeclaration(declaration);
        if (own) declarations.push(own);
      }
    }
    if (name === 'bgcolor' && value.trim()) declarations.push(`background-color: ${value.trim()}`);
  }
  return declarations.join('; ');
}

interface Sheet {
  css: string;
  media: string | null;
}

/** Every stylesheet the document carries: head styles and links, body styles. */
function stylesheets(doc: Node): Sheet[] {
  const sheets: Sheet[] = [];
  const envelope = envelopeOf(doc);
  if (envelope?.head) {
    const head = new DOMParser().parseFromString(
      `<!doctype html><html><head>${envelope.head}</head><body></body></html>`,
      'text/html',
    ).head;
    for (const element of Array.from(head.querySelectorAll('style, link[rel~="stylesheet"]'))) {
      const media = element.getAttribute('media');
      if (element.tagName === 'LINK') {
        const href = element.getAttribute('href');
        if (href) sheets.push({ css: `@import url("${href.replace(/"/g, '%22')}");`, media });
      } else {
        sheets.push({ css: element.textContent ?? '', media });
      }
    }
  }
  doc.descendants((node) => {
    if (node.type.name !== 'htmlRaw') return true;
    const attrs = node.attrs['attrs'] as AttributePairs;
    const media = attrs.find(([name]) => name === 'media')?.[1] ?? null;
    sheets.push({ css: node.attrs['text'] as string, media });
    return false;
  });
  return sheets;
}

/** An `@import` or `@charset` statement, through to its own `;` — strings
    and `url(…)` read whole. */
const IMPORT_STATEMENT =
  /@(?:import|charset)\b(?:[^;"'(]|"[^"]*"|'[^']*'|\((?:[^)"']|"[^"]*"|'[^']*')*\))*;/g;

export interface ScopedDocumentCssOptions {
  /** The editor root's tag — what stands for the document's `<body>`.
      `div` by default. */
  readonly root?: string;
  /** See {@link DocumentStylesOptions.darkScope}. */
  readonly darkScope?: string;
}

/**
 * One stylesheet text: hoisted imports, then everything else under `@scope`
 * — one block for the editor (`.<scope>`), and one more for each run of
 * rules a document keeps for dark or for light (`prefers-color-scheme`),
 * scoped to the editor while its paper is that, in the order written. Rules
 * for the document's body are sent to the root (see
 * {@link createDocumentStyles}).
 */
export function scopedDocumentCss(
  doc: Node,
  scope: string,
  options: ScopedDocumentCssOptions = {},
): string {
  const context: Context = {
    root: options.root ?? 'div',
    body: bodyOf(envelopeOf(doc)),
  };
  const darkScope = options.darkScope ?? DARK_PAPER_SCOPE;
  const imports: string[] = [];
  const runs: Run[] = [];
  for (const sheet of stylesheets(doc)) {
    let css = sheet.css;
    // `@import`/`@charset` must precede every other rule of a stylesheet. A
    // statement ends at the first `;` outside a string and a `url(…)` — a
    // Google Fonts URL holds them (`wght@0,100..900;1,100..900`), and cut
    // there, its unclosed `url(` swallowed every rule after it.
    css = css.replace(IMPORT_STATEMENT, (statement) => {
      // An unquoted URL holding a `;` is CSS, but not every engine's parser
      // reads it (jsdom's does not): quoted, it says the same to all. The
      // editor's copy of the sheet only — the email keeps its text.
      const quoted = statement.replace(
        /url\(\s*([^"'()\s][^()]*?)\s*\)/g,
        (_, url: string) => `url("${url.replace(/"/g, '%22')}")`,
      );
      imports.push(sheet.media ? quoted.replace(/;$/, ` ${sheet.media};`) : quoted);
      return '';
    });
    if (!css.trim()) continue;
    for (const run of runsOf(sheet.media ? `@media ${sheet.media} {\n${css}\n}` : css, context)) {
      const last = runs[runs.length - 1];
      // Two sheets stay two lines of one block, as they always were.
      if (last && last.scheme === run.scheme) last.text += `\n${run.text}`;
      else runs.push(run);
    }
  }
  if (!imports.length && !runs.length) return '';
  const own = `.${scope}`;
  const roots: Record<Scheme, string> = {
    any: own,
    dark: `${darkScope}${own}`,
    light: `${own}:not(${darkScope})`,
  };
  return [...imports, ...runs.map((run) => `@scope (${roots[run.scheme]}) {\n${run.text}\n}`)].join(
    '\n',
  );
}

// ── the sheet, read ─────────────────────────────────────────────────────

/** When a run of rules applies: always, or while the paper is dark, or
    light. */
type Scheme = 'any' | 'dark' | 'light';

interface Run {
  scheme: Scheme;
  text: string;
}

interface Context {
  root: string;
  /** The document's `<body>`, in its `<html>`, as its attributes say them —
      what a rule for the body is read against. Null for a fragment. */
  body: Element | null;
}

/** The document's body, detached, for a selector to be matched against. */
function bodyOf(envelope: DocumentEnvelope | null): Element | null {
  if (!envelope) return null;
  const make = (tag: string, attrs: AttributePairs) => {
    const element = document.createElement(tag);
    for (const [name, value] of attrs ?? []) {
      try {
        element.setAttribute(name, value);
      } catch {
        // A name no DOM takes (`o:x`) says nothing a selector could ask.
      }
    }
    return element;
  };
  const html = make('html', envelope.html);
  const body = make('body', envelope.body);
  html.appendChild(body);
  return body;
}

/** One statement of a sheet: a rule with its block, or an at-rule ended by
    a `;`. `start` takes in the space and comments before it. */
interface Statement {
  start: number;
  /** Where its own text begins, after that space. */
  at: number;
  end: number;
  prelude: string;
  /** The block's inside, `[from, to)` — null for a statement with none. */
  block: [number, number] | null;
}

/** Where a string opened at `i` closes. */
function stringEnd(css: string, i: number): number {
  const quote = css[i];
  for (let j = i + 1; j < css.length; j++) {
    if (css[j] === '\\') j++;
    else if (css[j] === quote) return j;
  }
  return css.length - 1;
}

/** Where a comment opened at `i` closes (its last character). */
function commentEnd(css: string, i: number): number {
  const close = css.indexOf('*/', i + 2);
  return close < 0 ? css.length - 1 : close + 1;
}

/** The brace matching the one at `open` — the text's end where none does. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const char = css[i];
    if (char === '"' || char === "'") i = stringEnd(css, i);
    else if (char === '/' && css[i + 1] === '*') i = commentEnd(css, i);
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return i;
  }
  return css.length;
}

/** A sheet's statements, in order, covering all of its text. */
function statementsOf(css: string): Statement[] {
  const found: Statement[] = [];
  let i = 0;
  while (i < css.length) {
    const start = i;
    while (i < css.length) {
      if (/\s/.test(css[i])) i++;
      else if (css[i] === '/' && css[i + 1] === '*') i = commentEnd(css, i) + 1;
      else break;
    }
    if (i >= css.length) break;
    const at = i;
    let depth = 0;
    let k = at;
    for (; k < css.length; k++) {
      const char = css[k];
      if (char === '"' || char === "'") k = stringEnd(css, k);
      else if (char === '/' && css[k + 1] === '*') k = commentEnd(css, k);
      else if (char === '(' || char === '[') depth++;
      else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
      else if (depth === 0 && (char === '{' || char === ';' || char === '}')) break;
    }
    if (k >= css.length || css[k] !== '{') {
      const end = Math.min(css.length, k + 1);
      found.push({ start, at, end, prelude: css.slice(at, k), block: null });
      i = end;
      continue;
    }
    const close = blockEnd(css, k);
    found.push({
      start,
      at,
      end: Math.min(css.length, close + 1),
      prelude: css.slice(at, k),
      block: [k + 1, Math.min(css.length, close)],
    });
    i = close + 1;
  }
  // What trails the last statement (space, a comment) stays with it.
  if (found.length) found[found.length - 1].end = css.length;
  return found;
}

const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** At-rules whose block holds rules of its own, read like a sheet. */
const GROUPING = /^@(?:media|supports|layer|container|document)\b/i;

/** `prefers-color-scheme` asked in a media query. */
const SCHEME_FEATURE = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi;

/** Always true, where a scheme stood: the scope says it now. */
const ALWAYS = '(min-width: 0px)';

/** A sheet as runs: its statements in order, a run of them for each stretch
    that applies always, in dark, or in light — a top-level `@media` that
    asks `prefers-color-scheme` its own run, the question taken out. Text no
    rule of which is rewritten stays as written. */
function runsOf(css: string, context: Context): Run[] {
  const runs: Run[] = [];
  const add = (scheme: Scheme, text: string) => {
    const last = runs[runs.length - 1];
    if (last && last.scheme === scheme) last.text += text;
    else runs.push({ scheme, text });
  };
  for (const statement of statementsOf(css)) {
    const lead = css.slice(statement.start, statement.at);
    const asked = /^@media\b/i.test(statement.prelude)
      ? SCHEME_FEATURE.exec(statement.prelude)
      : null;
    SCHEME_FEATURE.lastIndex = 0;
    if (asked && statement.block) {
      const scheme = asked[1].toLowerCase() as Scheme;
      const inner = rewritten(css.slice(...statement.block), context);
      const query = withoutComments(statement.prelude)
        .replace(/^@media\b/i, '')
        .replace(SCHEME_FEATURE, ALWAYS)
        .trim();
      // Nothing else asked: the rules stand in the scope as they are.
      add(scheme, lead + (query === ALWAYS ? inner.trim() : `@media ${query} {${inner}}`));
      // Add the space after it back, so the next statement starts its own line.
      add(scheme, css.slice(blockEndOf(statement) + 1, statement.end));
      continue;
    }
    // A body rule's dark twin goes after the rule it is of.
    const twins: string[] = [];
    add('any', lead + statementText(css, statement, context, twins));
    for (const twin of twins) add('dark', twin);
  }
  return runs.filter((run) => run.text.trim());
}

const blockEndOf = (statement: Statement): number => statement.block![1];

/** A sheet's text with its body rules sent to the root — for a block inside
    an at-rule, where a scheme is no longer told apart. */
function rewritten(css: string, context: Context): string {
  let out = '';
  for (const statement of statementsOf(css)) {
    out += css.slice(statement.start, statement.at) + statementText(css, statement, context, null);
  }
  return out;
}

/** One statement's text: as written, or with its body rules sent to the
    root. `twins` takes the dark twin of a body rule (top level only). */
function statementText(
  css: string,
  statement: Statement,
  context: Context,
  twins: string[] | null,
): string {
  const written = css.slice(statement.at, statement.end);
  if (!statement.block || !context.body) return written;
  const prelude = statement.prelude.trim();
  if (prelude.startsWith('@')) {
    if (!GROUPING.test(prelude)) return written;
    const inner = css.slice(...statement.block);
    const next = rewritten(inner, context);
    if (next === inner) return written;
    return `${statement.prelude}{${next}}${css.slice(statement.block[1] + 1, statement.end)}`;
  }
  const selectors = splitTop(withoutComments(prelude), ',').map((selector) => selector.trim());
  if (!selectors.some((selector) => bodyCompound(selector))) return written;

  const block = css.slice(...statement.block);
  const kept: string[] = [];
  const onRoot: string[] = [];
  for (const selector of selectors) {
    const sent = toRoot(selector, context);
    if (sent === undefined) kept.push(selector);
    else if (sent && sent.subject) onRoot.push(sent.selector);
    else if (sent) kept.push(sent.selector);
  }
  const rules: string[] = [];
  if (kept.length) rules.push(`${kept.join(', ')} {${block}}`);
  if (onRoot.length) {
    const declarations = rootDeclarations(block);
    if (declarations.length) {
      rules.push(`${onRoot.join(', ')} { ${declarations.join('; ')}; }`);
      const dark = darkDeclarations(declarations);
      // On dark paper, what the body paints is drawn dark, as Dawn draws
      // every colour there — right after the rule, so a dark rule of the
      // document's own, written later, still has the last word.
      if (dark.length) twins?.push(`\n${onRoot.join(', ')} { ${dark.join('; ')}; }\n`);
    }
  }
  return rules.join('\n') + css.slice(statement.block[1] + 1, statement.end);
}

/** A body rule's declarations as the root may take them: its box renamed,
    the rest of its geometry left out. */
function rootDeclarations(block: string): string[] {
  const declarations: string[] = [];
  for (const declaration of splitDeclarations(withoutComments(block))) {
    const own = rootDeclaration(declaration);
    if (!own) continue;
    const property = own.slice(0, own.indexOf(':')).trim().toLowerCase();
    if (!GEOMETRY_PROPERTY.test(property)) declarations.push(own);
  }
  return declarations;
}

/** The colours among declarations, each drawn dark by Dawn, as important as
    it was written. */
function darkDeclarations(declarations: string[]): string[] {
  const dark: string[] = [];
  for (const declaration of declarations) {
    const important = /!\s*important\s*$/i.test(declaration);
    const plain = declaration.replace(/!\s*important\s*$/i, '');
    for (const [property, value] of dawnDarkDeclarationsOf(plain)) {
      dark.push(`${property}: ${value}${important ? ' !important' : ''}`);
    }
  }
  return dark;
}

/** `text` cut at each `separator` outside brackets and strings. */
function splitTop(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' || char === "'") i = stringEnd(text, i);
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && char === separator) {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/** Where the compound that names the body stands in a selector — the last
    one whose type is `body` — as `[from, to)`; null where none does. */
function bodyCompound(selector: string): [number, number] | null {
  let found: [number, number] | null = null;
  let depth = 0;
  let from = 0;
  const close = (to: number) => {
    if (to > from && /^body(?![\w-])/i.test(selector.slice(from, to))) found = [from, to];
  };
  for (let i = 0; i < selector.length; i++) {
    const char = selector[i];
    if (char === '"' || char === "'") i = stringEnd(selector, i);
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[\s>+~]/.test(char)) {
      close(i);
      from = i + 1;
    }
  }
  close(selector.length);
  return found;
}

/** An id no element has: `:not(#…)` is true of every one, and weighs what
    an id does. */
const NO_ID = 'aee-no-such-id';

/**
 * A selector that names the document's body, said of the editor's root.
 *
 * The part up to its body (`[dir="rtl"] body.page`) is read against the body
 * the document has: where it does not match, the selector is none of this
 * document's (`false`); where it cannot be read, it stays as written
 * (`undefined`). Where it matches it becomes the root — `:scope`, by its
 * tag — carrying the weight the part had: `:is(<part, its body as *>, *)`
 * is true of anything and weighs what its heaviest side does, so `body td`
 * and `.x td` still meet as written. A selector for the body itself
 * (`subject`) weighs an id more: it stands where the host has rules of its
 * own for its surface, as a client's body stands over the client's.
 */
function toRoot(
  selector: string,
  context: Context,
): { selector: string; subject: boolean } | false | undefined {
  const compound = bodyCompound(selector);
  if (!compound || !context.body) return undefined;
  const part = selector.slice(0, compound[1]);
  const rest = selector.slice(compound[1]);
  let matches: boolean;
  try {
    matches = context.body.matches(part);
  } catch {
    return undefined;
  }
  if (!matches) return false;
  const weight = `${selector.slice(0, compound[0])}*${selector.slice(compound[0] + 4, compound[1])}`;
  const root = `${context.root}:where(:scope)${weight === '*' ? '' : `:is(${weight}, *)`}`;
  const subject = !rest.trim();
  return { selector: subject ? `${root}:not(#${NO_ID})` : `${root}${rest}`, subject };
}

class DocumentStylesView {
  #element: HTMLStyleElement | null = null;
  #last = '';

  constructor(
    view: EditorView,
    private readonly scope: string,
    private readonly darkScope: string,
  ) {
    this.update(view);
  }

  update(view: EditorView): void {
    const css = scopedDocumentCss(view.state.doc, this.scope, {
      root: view.dom.localName,
      darkScope: this.darkScope,
    });
    if (css === this.#last) return;
    this.#last = css;

    if (!css) {
      this.#element?.remove();
      this.#element = null;
      return;
    }
    if (!this.#element) {
      this.#element = view.dom.ownerDocument.createElement('style');
      this.#element.className = 'aee-document-styles';
      view.dom.parentNode?.insertBefore(this.#element, view.dom);
    }
    this.#element.textContent = css;
  }

  destroy(): void {
    this.#element?.remove();
    this.#element = null;
  }
}
