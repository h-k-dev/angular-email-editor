import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { defineExtension } from '../extension';
import {
  DAWN_SURFACE,
  dawnBandOf,
  dawnDarkColor,
  dawnDarkDeclarationsOf,
  dawnDarkLegacyColor,
} from '@h-k-dev/dawn';

/** The editor's root while its paper is dark, where a host says nothing
    else: under any element that says `data-color-scheme="dark"`. */
export const DARK_PAPER_SCOPE = ":where([data-color-scheme='dark']) .aee-editor";

export interface DarkRenderingOptions {
  /** A selector the editor's root (`.aee-editor`) matches while its paper is
      dark — the host says when, the way it already marks its paper.
      `:where([data-color-scheme='dark']) .aee-editor` by default: dark
      under any element that says `data-color-scheme="dark"`. */
  readonly scope?: string;
}

/** A value as a CSS string's contents, quoted: `"` and `\` escaped, a line
    break as `\a `. */
const cssString = (value: string): string =>
  `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\a ')}"`;

/** What the legacy attributes paint, by attribute. */
const LEGACY: readonly [attribute: string, selector: string, property: string][] = [
  ['bgcolor', '[bgcolor=%]', 'background-color'],
  ['color', 'font[color=%]', 'color'],
  ['bordercolor', '[bordercolor=%]', 'border-color'],
];

/**
 * The band an element lies on, as two inherited flags — CSS has no "nearest
 * ancestor" selector, and inheritance is exactly that. A flag is empty while
 * it holds and `initial` (no value at all) while it does not, so of
 * `var(--aee-not-kept, written) var(--aee-not-drawn, drawn)` exactly one
 * fallback is read: the written value on a band kept as written, the drawn
 * one on any other. Every element that paints a band sets both.
 */
const BAND = {
  kept: '--aee-not-kept: initial; --aee-not-drawn: ;',
  drawn: '--aee-not-kept: ; --aee-not-drawn: initial;',
} as const;

/** A border's value by the band beneath it: as written on a kept one. */
const onBand = (written: string, drawn: string): string =>
  `var(--aee-not-kept, ${written}) var(--aee-not-drawn, ${drawn})`;

/** One style spelling's rule body: its colours drawn dark, its borders by
    the band beneath, and — where it paints a band itself — the flags for
    what lies on it. Empty where dark changes nothing. Without `custom`,
    its custom properties are left as written. */
function darkBody(style: string, custom = true): string {
  const body = dawnDarkDeclarationsOf(style)
    .filter(([property]) => custom || !property.startsWith('--'))
    .map(([property, value, written]) =>
      written === undefined
        ? `${property}: ${value} !important;`
        : `${property}: ${onBand(written, value)} !important;`,
    );
  const band = dawnBandOf(style);
  if (band) body.push(BAND[band]);
  return body.join(' ');
}

let nextId = 0;

/**
 * The editor's paper drawn dark by Dawn — the engine that draws the email
 * in a reading pane and a thumbnail (`renderDawn`), so the three never
 * disagree. Nothing in the document changes: the colours written stay the
 * light ones, and a sheet over the editor draws each one dark while the
 * root matches `scope`.
 *
 * The live text cannot be rewritten (the editor would read the change as an
 * edit), so the sheet has a rule per colour spelling in the editor: an
 * element's whole `style` text, matched exactly, with its colour-painting
 * declarations drawn dark (`!important`, over the inline ones), and its
 * legacy colour attributes (`bgcolor`, `<font color>`, `bordercolor`) the
 * same — the style's rules last, as an inline style beats an attribute.
 * A border follows the band it lies on, as in the reading pane: as written
 * on a background kept as written (`BAND`).
 * The root takes Dawn's ink and dark surface — and where it carries a look
 * of its own (a document's `<body>` fill, put on it inline by
 * `DocumentStyles`), that is drawn dark like any other: a white body is no
 * white strip under a dark email. Its custom properties are left as written
 * (the page layout's fills, which say their own dark). The sheet is made
 * again whenever the
 * spellings in the editor change, and leaves with the editor.
 *
 * What the editor does not draw — a pasted document's `<style>` — is not
 * here: a message that declares dark itself is the reading pane's to honour.
 */
export function createDarkRendering(options: DarkRenderingOptions = {}) {
  const scope = options.scope ?? DARK_PAPER_SCOPE;
  return defineExtension({
    name: 'darkRendering',
    plugins: () => {
      const id = String(++nextId);
      return [
        new Plugin({
          key: new PluginKey('darkRendering'),
          props: { attributes: { 'data-aee-render': id } },
          view: (view) => {
            const root = `${scope}[data-aee-render="${id}"]`;
            const sheet = view.dom.ownerDocument.createElement('style');
            sheet.setAttribute('data-aee-render', id);
            const host = view.root as Document | ShadowRoot;
            ('head' in host ? host.head : host).appendChild(sheet);
            let spellings = '';
            const draw = (view: EditorView) => {
              const { css, key } = darkRenderingCss(view.dom, root);
              if (key === spellings) return;
              spellings = key;
              sheet.textContent = css;
            };
            draw(view);
            return {
              update: (view, previous) => {
                if (!previous.doc.eq(view.state.doc)) draw(view);
              },
              destroy: () => sheet.remove(),
            };
          },
        }),
      ];
    },
  });
}

/** The sheet that draws everything under `dom` dark by Dawn, every rule
    under `root` — and a key of the spellings it was made from, to tell when
    it must be made again. */
export function darkRenderingCss(dom: Element, root: string): { css: string; key: string } {
  const styles = new Set<string>();
  const legacy = new Map<string, Set<string>>(LEGACY.map(([attribute]) => [attribute, new Set()]));
  for (const element of Array.from(
    dom.querySelectorAll('[style], [bgcolor], font[color], [bordercolor]'),
  )) {
    const style = element.getAttribute('style');
    if (style) styles.add(style);
    for (const [attribute] of LEGACY) {
      const value = element.getAttribute(attribute);
      if (value && (attribute !== 'color' || element.localName === 'font')) {
        legacy.get(attribute)!.add(value);
      }
    }
  }
  const rules = [
    `${root} { color: ${dawnDarkColor('#000000')}; background-color: ${DAWN_SURFACE.dark}; ${BAND.drawn} }`,
  ];
  for (const [attribute, selector, property] of LEGACY) {
    for (const value of legacy.get(attribute)!) {
      const drawn = dawnDarkLegacyColor(
        value,
        attribute === 'bgcolor' ? 'surface' : attribute === 'color' ? 'ink' : undefined,
      );
      const body: string[] = [];
      if (drawn) {
        body.push(
          attribute === 'bordercolor'
            ? `${property}: ${onBand(value, drawn)} !important;`
            : `${property}: ${drawn} !important;`,
        );
      }
      const band = attribute === 'bgcolor' ? dawnBandOf(`background-color: ${value}`) : null;
      if (band) body.push(BAND[band]);
      if (body.length) {
        rules.push(
          `${root} ${selector.replace('%', cssString(value) + ' i')} { ${body.join(' ')} }`,
        );
      }
    }
  }
  for (const style of styles) {
    const body = darkBody(style);
    if (body) rules.push(`${root} [style=${cssString(style)}] { ${body} }`);
  }
  // The root's own look — a document's body, on it inline: drawn dark too,
  // over the surface above. Never its custom properties: those are the
  // editor's own (the page layout's `--aee-page-background` and its
  // `-dark`, each already written for its light) — drawn dark again, the
  // dark one comes out light, and the page's room with it.
  const own = dom.getAttribute('style') ?? '';
  const ownBody = own ? darkBody(own, false) : '';
  if (ownBody) rules.push(`${root}[style=${cssString(own)}] { ${ownBody} }`);
  const key = [
    own,
    '|',
    ...styles,
    '|',
    ...[...legacy.values()].flatMap((set) => [...set, '|']),
  ].join('\n');
  return { css: rules.join('\n'), key };
}
