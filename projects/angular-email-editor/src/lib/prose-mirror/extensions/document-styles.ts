import { Node } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { defineExtension } from '../extension';
import { DocumentEnvelope } from '../envelope';
import { AttributePairs } from '../preserve';
import { splitDeclarations } from '../email-vocabulary';

/** Editor root class while the document carries an envelope — the host's
    hook for rendering a template like a client would (browser typography
    rather than the composer's), see the example app's styles. */
export const DOCUMENT_CLASS = 'aee-document';

let instances = 0;

/**
 * Applies a preserved document's stylesheets to the editor view, so the
 * visual pane renders an MJML-class template exactly as the preview does:
 * the head's `<style>` blocks (media queries included — that is what makes
 * MJML columns responsive), its `<link rel="stylesheet">`s, and any `<style>`
 * in the body. Everything is wrapped in `@scope (.<this editor>) { … }`, so
 * a template's `table, td { … }` or `p { margin: 13px 0 }` reaches this
 * editor's content and nothing else on the page (`body { … }` rules match
 * nothing inside a scope and simply do not apply). `@import`s are hoisted
 * ahead of the scope block, where CSS requires them. The `<body>`'s own
 * inline style and `bgcolor` land on the editor root, the closest thing the
 * editable view has to a body — all but its box: the root's margin and
 * padding are the host's layout (its gutters, a page layout's column, the
 * room under the last line), and an inline `padding: 0` from a template
 * would beat every rule of it. The body's `margin*` and `padding*` go out as
 * custom properties instead ({@link BODY_BOX_PREFIX}: `--aee-body-padding`,
 * `--aee-body-margin-top`, …), for a host that wants to draw them.
 *
 * Behaviour only: the style element sits beside the editor's DOM and is
 * removed with it. No pixels of its own.
 */
export const DocumentStyles = defineExtension({
  name: 'documentStyles',
  plugins: () => {
    const scope = `aee-doc-${++instances}`;
    return [
      new Plugin({
        key: new PluginKey('documentStyles'),
        props: {
          attributes: (state) => rootAttributes(scope, state.doc),
        },
        view: (view) => new DocumentStylesView(view, scope),
      }),
    ];
  },
});

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

/** The body's inline style plus its legacy `bgcolor`, as one declaration
    list — its box as custom properties (see {@link DocumentStyles}). */
function bodyStyle(body: AttributePairs): string {
  const declarations: string[] = [];
  for (const [name, value] of body) {
    if (name === 'style') {
      for (const declaration of splitDeclarations(value)) {
        const colon = declaration.indexOf(':');
        if (colon < 0) continue;
        const property = declaration.slice(0, colon).trim();
        const rest = declaration.slice(colon + 1).trim();
        if (!property || !rest) continue;
        // Only the box is renamed: a template's own custom property keeps
        // its case, which is its name.
        const box = property.toLowerCase();
        declarations.push(
          BOX_PROPERTY.test(box) ? `${BODY_BOX_PREFIX}${box}: ${rest}` : `${property}: ${rest}`,
        );
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

/** One stylesheet text: hoisted imports, then everything else under `@scope`. */
export function scopedDocumentCss(doc: Node, scope: string): string {
  const imports: string[] = [];
  const scoped: string[] = [];
  for (const sheet of stylesheets(doc)) {
    let css = sheet.css;
    // `@import`/`@charset` must precede every other rule of a stylesheet.
    css = css.replace(/@(?:import|charset)\b[^;]*;/g, (statement) => {
      imports.push(sheet.media ? statement.replace(/;$/, ` ${sheet.media};`) : statement);
      return '';
    });
    if (!css.trim()) continue;
    scoped.push(sheet.media ? `@media ${sheet.media} {\n${css}\n}` : css);
  }
  if (!imports.length && !scoped.length) return '';
  return [...imports, `@scope (.${scope}) {`, ...scoped, '}'].join('\n');
}

class DocumentStylesView {
  #element: HTMLStyleElement | null = null;
  #last = '';

  constructor(
    view: EditorView,
    private readonly scope: string,
  ) {
    this.update(view);
  }

  update(view: EditorView): void {
    const css = scopedDocumentCss(view.state.doc, this.scope);
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
