/**
 * The email vocabulary: every tag, attribute and CSS property that at least
 * one of the floor clients — **Apple Mail, Outlook, Gmail** — applies. This is
 * what the default `email` parse mode recognizes and keeps *exactly as
 * authored*; it is the reason MJML's output survives untouched, because MJML
 * emits nothing a floor client ignores.
 *
 * Curation rule: grounded in caniemail's feature list (a feature supported by
 * any one of the three clients is usable), plus Outlook's own dialect
 * (`mso-*` properties, VML and Office namespaced elements), plus the legacy
 * presentational HTML every email toolchain still relies on (`bgcolor`,
 * `cellpadding`, `align`, …). Anything outside — framework attributes
 * (`ng-*`, `v-*`), `data-*`, typos, invented CSS properties, custom elements —
 * is dropped by the `email` parse and kept only in `preserve` mode, which is
 * the opt-in for special needs.
 *
 * Deliberately static: filtering by what the *running* browser knows
 * (`CSS.supports`, `in style`) would make canonical output depend on the
 * engine — and no browser knows `mso-*`.
 */

import { REFUSED_TAGS } from './html-tags';

/** Tags applied by at least one floor client. */
export const EMAIL_TAGS = new Set([
  // Document envelope
  'html',
  'head',
  'body',
  'title',
  'meta',
  'link',
  'style',
  // Sections and grouping
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'noscript',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'ul',
  // Tables — the most client-compatible layout there is
  'caption',
  'col',
  'colgroup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  // Text-level
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'big',
  'br',
  'cite',
  'code',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'mark',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'time',
  'tt',
  'u',
  'var',
  'wbr',
  // Media — Apple Mail plays video and audio; <picture> selects sources
  'area',
  'audio',
  'img',
  'map',
  'picture',
  'source',
  'track',
  'video',
  // Interactive — Apple Mail honours forms and the checkbox hack MJML's
  // navbar and every "interactive email" relies on
  'button',
  'fieldset',
  'form',
  'input',
  'label',
  'legend',
  'meter',
  'optgroup',
  'option',
  'progress',
  'select',
  'textarea',
]);

/** Outlook's own elements (`<v:rect>`, `<o:p>`, `<w:anchorlock>`) — VML and
    Office markup that the Word engine renders. */
const OUTLOOK_ELEMENT = /^(?:v|o|w):[a-z]/i;

/** Attributes applied by at least one floor client, on any element — the
    global set, the legacy presentational set, and the per-element ones
    flattened (an `href` on a `<div>` is inert, not harmful). */
export const EMAIL_ATTRIBUTES = new Set([
  // Global
  'class',
  'dir',
  'hidden',
  'id',
  'lang',
  'role',
  'style',
  'tabindex',
  'title',
  'translate',
  'xml:lang',
  'xmlns',
  // Legacy presentational — the backbone of table-based email
  'align',
  'alink',
  'background',
  'bgcolor',
  'border',
  'bordercolor',
  'cellpadding',
  'cellspacing',
  'char',
  'charoff',
  'clear',
  'color',
  'compact',
  'face',
  'frame',
  'height',
  'hspace',
  'leftmargin',
  'link',
  'marginheight',
  'marginwidth',
  'noshade',
  'nowrap',
  'rules',
  'size',
  'text',
  'topmargin',
  'valign',
  'vlink',
  'vspace',
  'width',
  // Tables
  'abbr',
  'axis',
  'colspan',
  'headers',
  'rowspan',
  'scope',
  'span',
  'summary',
  // Links and media
  'alt',
  'autoplay',
  'controls',
  'coords',
  'download',
  'href',
  'hreflang',
  'ismap',
  'loop',
  'media',
  'muted',
  'name',
  'playsinline',
  'poster',
  'preload',
  'rel',
  'shape',
  'sizes',
  'src',
  'srcset',
  'target',
  'type',
  'usemap',
  // Lists, quotes, edits
  'cite',
  'datetime',
  'reversed',
  'start',
  'value',
  // Forms
  'action',
  'checked',
  'cols',
  'disabled',
  'enctype',
  'for',
  'label',
  'max',
  'maxlength',
  'method',
  'min',
  'multiple',
  'open',
  'placeholder',
  'readonly',
  'required',
  'rows',
  'selected',
  'step',
  // Document head
  'charset',
  'content',
  'http-equiv',
]);

/** Attribute name patterns applied by floor clients: ARIA, and XML
    namespace declarations (`xmlns:v`, `xmlns:o` — what makes VML work). */
const EMAIL_ATTRIBUTE_PATTERN = /^(?:aria-[a-z]+|xmlns:[a-z]+)$/;

/** CSS properties applied by at least one floor client — caniemail's
    property list plus the universally supported basics it doesn't track. */
export const EMAIL_CSS_PROPERTIES = new Set([
  'accent-color',
  'align-content',
  'align-items',
  'align-self',
  'animation',
  'animation-delay',
  'animation-direction',
  'animation-duration',
  'animation-fill-mode',
  'animation-iteration-count',
  'animation-name',
  'animation-play-state',
  'animation-timing-function',
  'appearance',
  'aspect-ratio',
  'backdrop-filter',
  'background',
  'background-attachment',
  'background-blend-mode',
  'background-clip',
  'background-color',
  'background-image',
  'background-origin',
  'background-position',
  'background-position-x',
  'background-position-y',
  'background-repeat',
  'background-size',
  'block-size',
  'border',
  'border-block',
  'border-block-color',
  'border-block-end',
  'border-block-end-color',
  'border-block-end-style',
  'border-block-end-width',
  'border-block-start',
  'border-block-start-color',
  'border-block-start-style',
  'border-block-start-width',
  'border-block-style',
  'border-block-width',
  'border-bottom',
  'border-bottom-color',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-style',
  'border-bottom-width',
  'border-collapse',
  'border-color',
  'border-end-end-radius',
  'border-end-start-radius',
  'border-image',
  'border-image-outset',
  'border-image-repeat',
  'border-image-slice',
  'border-image-source',
  'border-image-width',
  'border-inline',
  'border-inline-color',
  'border-inline-end',
  'border-inline-end-color',
  'border-inline-end-style',
  'border-inline-end-width',
  'border-inline-start',
  'border-inline-start-color',
  'border-inline-start-style',
  'border-inline-start-width',
  'border-inline-style',
  'border-inline-width',
  'border-left',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-spacing',
  'border-start-end-radius',
  'border-start-start-radius',
  'border-style',
  'border-top',
  'border-top-color',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-style',
  'border-top-width',
  'border-width',
  'bottom',
  'box-shadow',
  'box-sizing',
  'caption-side',
  'caret-color',
  'clear',
  'clip',
  'clip-path',
  'color',
  'color-scheme',
  'column-count',
  'column-fill',
  'column-gap',
  'column-rule',
  'column-rule-color',
  'column-rule-style',
  'column-rule-width',
  'column-span',
  'column-width',
  'columns',
  'content',
  'counter-increment',
  'counter-reset',
  'cursor',
  'direction',
  'display',
  'empty-cells',
  'filter',
  'flex',
  'flex-basis',
  'flex-direction',
  'flex-flow',
  'flex-grow',
  'flex-shrink',
  'flex-wrap',
  'float',
  'font',
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-size',
  'font-size-adjust',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-variant-caps',
  'font-variant-ligatures',
  'font-variant-numeric',
  'font-weight',
  'gap',
  'grid',
  'grid-area',
  'grid-auto-columns',
  'grid-auto-flow',
  'grid-auto-rows',
  'grid-column',
  'grid-column-end',
  'grid-column-gap',
  'grid-column-start',
  'grid-gap',
  'grid-row',
  'grid-row-end',
  'grid-row-gap',
  'grid-row-start',
  'grid-template',
  'grid-template-areas',
  'grid-template-columns',
  'grid-template-rows',
  'height',
  'hyphenate-character',
  'hyphens',
  'image-rendering',
  'inline-size',
  'inset',
  'inset-block',
  'inset-block-end',
  'inset-block-start',
  'inset-inline',
  'inset-inline-end',
  'inset-inline-start',
  'isolation',
  'justify-content',
  'justify-items',
  'justify-self',
  'left',
  'letter-spacing',
  'line-break',
  'line-height',
  'list-style',
  'list-style-image',
  'list-style-position',
  'list-style-type',
  'margin',
  'margin-block',
  'margin-block-end',
  'margin-block-start',
  'margin-bottom',
  'margin-inline',
  'margin-inline-end',
  'margin-inline-start',
  'margin-left',
  'margin-right',
  'margin-top',
  'mask',
  'mask-image',
  'max-block-size',
  'max-height',
  'max-inline-size',
  'max-width',
  'min-block-size',
  'min-height',
  'min-inline-size',
  'min-width',
  'mix-blend-mode',
  'object-fit',
  'object-position',
  'opacity',
  'order',
  'orphans',
  'outline',
  'outline-color',
  'outline-offset',
  'outline-style',
  'outline-width',
  'overflow',
  'overflow-wrap',
  'overflow-x',
  'overflow-y',
  'padding',
  'padding-block',
  'padding-block-end',
  'padding-block-start',
  'padding-bottom',
  'padding-inline',
  'padding-inline-end',
  'padding-inline-start',
  'padding-left',
  'padding-right',
  'padding-top',
  'page-break-after',
  'page-break-before',
  'page-break-inside',
  'perspective',
  'place-content',
  'place-items',
  'place-self',
  'pointer-events',
  'position',
  'quotes',
  'resize',
  'right',
  'rotate',
  'row-gap',
  'scale',
  'scroll-behavior',
  'scroll-snap-align',
  'scroll-snap-type',
  'speak',
  'tab-size',
  'table-layout',
  'text-align',
  'text-align-last',
  'text-decoration',
  'text-decoration-color',
  'text-decoration-line',
  'text-decoration-skip-ink',
  'text-decoration-style',
  'text-decoration-thickness',
  'text-emphasis',
  'text-emphasis-color',
  'text-emphasis-position',
  'text-emphasis-style',
  'text-indent',
  'text-orientation',
  'text-overflow',
  'text-rendering',
  'text-shadow',
  'text-size-adjust',
  'text-transform',
  'text-underline-offset',
  'text-underline-position',
  'top',
  'transform',
  'transform-origin',
  'transition',
  'transition-delay',
  'transition-duration',
  'transition-property',
  'transition-timing-function',
  'translate',
  'unicode-bidi',
  'user-select',
  'vertical-align',
  'visibility',
  'white-space',
  'white-space-collapse',
  'widows',
  'width',
  'will-change',
  'word-break',
  'word-spacing',
  'word-wrap',
  'writing-mode',
  'z-index',
  'zoom',
]);

/** Vendor-only properties with no unprefixed twin in the list above. */
const VENDOR_ONLY_PROPERTIES = new Set([
  'font-smoothing',
  'interpolation-mode',
  'line-clamp',
  'box-orient',
  'osx-font-smoothing',
  'tap-highlight-color',
  'text-fill-color',
  'text-stroke',
  'text-stroke-color',
  'text-stroke-width',
  'touch-callout',
]);

/** Whether a tag is applied by at least one floor client. */
export function isEmailTag(tag: string): boolean {
  return EMAIL_TAGS.has(tag) || OUTLOOK_ELEMENT.test(tag);
}

/** Whether an attribute is applied by at least one floor client. Outlook's
    own elements keep all their attributes — VML is its own vocabulary. */
export function isEmailAttribute(name: string, tag = ''): boolean {
  return (
    EMAIL_ATTRIBUTES.has(name) || EMAIL_ATTRIBUTE_PATTERN.test(name) || OUTLOOK_ELEMENT.test(tag)
  );
}

/**
 * Whether a CSS property is applied by at least one floor client: a listed
 * property, a vendor-prefixed one (`-webkit-`, `-moz-`, `-ms-`) of a listed
 * or known vendor-only property, Outlook's `mso-*`, or a custom property
 * (Apple Mail supports CSS variables).
 */
export function isEmailCssProperty(property: string): boolean {
  const name = property.trim().toLowerCase();
  if (EMAIL_CSS_PROPERTIES.has(name)) return true;
  if (/^mso-[a-z-]+$/.test(name) || /^--[\w-]+$/.test(name)) return true;
  const vendor = /^-(?:webkit|moz|ms)-([a-z-]+)$/.exec(name);
  return !!vendor && (EMAIL_CSS_PROPERTIES.has(vendor[1]) || VENDOR_ONLY_PROPERTIES.has(vendor[1]));
}

/** A style attribute split into declarations at top-level semicolons —
    never inside quotes or parentheses, so `url(data:image/png;base64,…)`
    stays one declaration. Each entry keeps its exact original text. */
export function splitDeclarations(style: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < style.length; i++) {
    const char = style[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth = Math.max(0, depth - 1);
    } else if (char === ';' && depth === 0) {
      parts.push(style.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(style.slice(start));
  return parts;
}

/** The property name of one declaration, lower-cased; `null` when the
    declaration has no `:` (empty or malformed). */
export function declarationProperty(declaration: string): string | null {
  const colon = declaration.indexOf(':');
  if (colon < 0) return null;
  return declaration.slice(0, colon).trim().toLowerCase();
}

/**
 * A style attribute with every declaration outside the email vocabulary
 * removed. **Byte-identical when nothing is dropped** — the kept declarations
 * keep their exact text and separators, so authored styles round-trip as
 * written. Returns the dropped property names alongside.
 */
export function filterEmailStyle(style: string): { style: string; dropped: string[] } {
  const parts = splitDeclarations(style);
  const dropped: string[] = [];
  const kept = parts.filter((part) => {
    const property = declarationProperty(part);
    if (property === null || isEmailCssProperty(property)) return true;
    dropped.push(property);
    return false;
  });
  if (!dropped.length) return { style, dropped };
  return {
    style: kept
      .join(';')
      .replace(/^\s*;\s*/, '')
      .trim(),
    dropped,
  };
}

/**
 * Applies the email vocabulary to a throwaway DOM, in place: elements
 * outside it are unwrapped (their content stays, as the repair parse does) —
 * except executable ones, which go with their content, never leaking it as
 * text — attributes outside it are removed, style declarations outside it
 * are removed. Comments and text are untouched. Runs before the `email` parse.
 */
export function applyEmailVocabulary(root: Element): void {
  // Deepest first, so an unwrap never skips a descendant.
  const elements = Array.from(root.querySelectorAll('*')).reverse();
  for (const element of [...elements, root]) {
    const tag = element.tagName.toLowerCase();
    for (const { name, value } of Array.from(element.attributes)) {
      if (!isEmailAttribute(name, tag)) {
        element.removeAttribute(name);
      } else if (name === 'style') {
        const filtered = filterEmailStyle(value);
        if (filtered.dropped.length) element.setAttribute('style', filtered.style);
      }
    }
    if (element === root) continue;
    if (REFUSED_TAGS.has(tag)) element.remove();
    else if (!isEmailTag(tag)) element.replaceWith(...Array.from(element.childNodes));
  }
}
