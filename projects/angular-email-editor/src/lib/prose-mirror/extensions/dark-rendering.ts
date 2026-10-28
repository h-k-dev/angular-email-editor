import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { defineExtension } from '../extension';
import {
  DAWN_SURFACE,
  dawnDarkColor,
  dawnDarkDeclarationsOf,
  dawnDarkLegacyColor,
} from '@h-k-dev/dawn';

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
 * The root takes Dawn's ink and dark surface. The sheet is made again
 * whenever the spellings in the editor change, and leaves with the editor.
 *
 * What the editor does not draw — a pasted document's `<style>` — is not
 * here: a message that declares dark itself is the reading pane's to honour.
 */
export function createDarkRendering(options: DarkRenderingOptions = {}) {
  const scope = options.scope ?? ":where([data-color-scheme='dark']) .aee-editor";
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
  for (const element of Array.from(dom.querySelectorAll('[style], [bgcolor], font[color], [bordercolor]'))) {
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
    `${root} { color: ${dawnDarkColor('#000000')}; background-color: ${DAWN_SURFACE.dark}; }`,
  ];
  for (const [attribute, selector, property] of LEGACY) {
    for (const value of legacy.get(attribute)!) {
      const drawn = dawnDarkLegacyColor(value);
      if (drawn) {
        rules.push(
          `${root} ${selector.replace('%', cssString(value) + ' i')} { ${property}: ${drawn} !important; }`,
        );
      }
    }
  }
  for (const style of styles) {
    const declarations = dawnDarkDeclarationsOf(style);
    if (!declarations.length) continue;
    const body = declarations.map(([property, value]) => `${property}: ${value} !important;`);
    rules.push(`${root} [style=${cssString(style)}] { ${body.join(' ')} }`);
  }
  const key = [...styles, '|', ...[...legacy.values()].flatMap((set) => [...set, '|'])].join('\n');
  return { css: rules.join('\n'), key };
}
