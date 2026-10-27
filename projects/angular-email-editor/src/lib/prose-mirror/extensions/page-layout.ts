import { Node, NodeRange, NodeType, Schema } from 'prosemirror-model';
import { Command, EditorState, Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { FunctionalExtension, defineExtension } from '../extension';
import { PaletteColor, emailBackgroundPalette, fillTextColor } from '../dual-contrast';
import { PAGE_ROW_PADDING_VAR, PageRowAttrs } from './nodes/page-row';
import { paddingOf, paddingSides } from '../inline-style';
import { PAGE_COLUMN_INSET, PageLayout, normalizePageLayout, samePageLayout } from '../page-layout';

/** Editor root class while the document has a page layout. */
export const PAGE_LAYOUT_CLASS = 'aee-page-layout';

/** The document's page layout (page-layout.ts), or null. */
export function pageLayoutOf(state: EditorState): PageLayout | null {
  return normalizePageLayout(state.doc.attrs['pageLayout']);
}

/** Sets the page layout — normalised (page-layout.ts) — or takes it away
    with `null`. One step, so undo puts the page back as it was — the rows a
    page of rows turns its blocks into (or back out of) with it. False when
    that is what it already is. */
export const setPageLayout =
  (layout: PageLayout | null): Command =>
  (state, dispatch) => {
    const next = normalizePageLayout(layout);
    if (samePageLayout(next, pageLayoutOf(state))) return false;
    dispatch?.(state.tr.setDocAttribute('pageLayout', next));
    return true;
  };

/** Whether the document is a page of rows (the `table` kind). */
export function isRowsPage(state: EditorState): boolean {
  return pageLayoutOf(state)?.kind === 'table';
}

/** A new plain row (page of rows): no fill, the column's inset all round,
    an empty line in it — null in a schema with no rows. */
export function plainRow(schema: Schema): Node | null {
  return schema.nodes['pageRow']?.createAndFill() ?? null;
}

/**
 * Keeps the top level what the page says it is. A page of rows has rows
 * only: a band becomes a band row (its fill and image, its padding above
 * and below, the band's inset at the sides), and the blocks between rows —
 * a free column's runs as the page turns into rows, a paste, a block
 * dropped between two — go into a plain row, a run of them each. Any other
 * page has none: a band row becomes a band, a plain row gives its blocks
 * back. A card — a band with a content colour, more than a row says —
 * stands in a plain row of its own, whole. Null when nothing is out of
 * place.
 * `before` is the page the step started from: a row with the page's
 * padding turns band with that page's.
 */
function fitToLayout(state: EditorState, before: PageLayout | null): Transaction | null {
  const row = state.schema.nodes['pageRow'];
  if (!row) return null;
  const band = state.schema.nodes['section'];
  const rows = isRowsPage(state);
  const children: [Node, number][] = [];
  state.doc.forEach((node, offset) => children.push([node, offset]));
  const tr = state.tr;
  // From the end, so the positions before each child stand.
  for (const [node, pos] of children.reverse()) {
    if (rows && node.type === band) {
      if (node.attrs['contentBackground']) {
        const range = new NodeRange(tr.doc.resolve(pos), tr.doc.resolve(pos + node.nodeSize), 0);
        tr.wrap(range, [{ type: row, attrs: { padding: '0px' } }]);
      } else {
        tr.setNodeMarkup(pos, row, rowOfBand(node.attrs));
      }
    } else if (!rows && node.type === row) {
      if (band && (node.attrs['background'] || node.attrs['color'] || node.attrs['image'])) {
        const page = before?.kind === 'table' ? before.rowPadding : PAGE_COLUMN_INSET;
        tr.setNodeMarkup(pos, band, bandOfRow(node.attrs as PageRowAttrs, `${page}px`));
      } else {
        const inside = new NodeRange(
          tr.doc.resolve(pos + 1),
          tr.doc.resolve(pos + node.nodeSize - 1),
          1,
        );
        tr.lift(inside, 0);
      }
    }
  }
  if (rows) wrapRuns(tr, row);
  return tr.docChanged ? tr : null;
}

/** The blocks between rows, each run of them into a plain row. */
function wrapRuns(tr: Transaction, row: NodeType): void {
  const runs: [number, number][] = [];
  let start = -1;
  tr.doc.forEach((node, offset) => {
    if (node.type !== row) {
      if (start < 0) start = offset;
    } else if (start >= 0) {
      runs.push([start, offset]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, tr.doc.content.size]);
  for (const [from, to] of runs.reverse()) {
    if (!row.validContent(tr.doc.slice(from, to).content)) continue;
    const range = new NodeRange(tr.doc.resolve(from), tr.doc.resolve(to), 0);
    // A plain row: the page's padding round its blocks, as a run's.
    tr.wrap(range, [{ type: row }]);
  }
}

/** A band's look as a row's: its fill and image, its padding above and
    below, the band's inset at the sides. */
function rowOfBand(attrs: Record<string, any>): PageRowAttrs {
  const [top, , bottom] = paddingSides(attrs['padding'] ?? '0px');
  const inset = `${attrs['inset'] ?? PAGE_COLUMN_INSET}px`;
  return {
    background: attrs['background'] ?? null,
    color: null,
    padding: paddingOf(top, inset, bottom, inset),
    image: attrs['image'] ?? null,
  };
}

/** A row's look as a band's: its fill and image, its padding above and
    below — its own, else the page's (`page`) — and its sides as the
    band's inset. */
function bandOfRow(attrs: PageRowAttrs, page: string): Record<string, unknown> {
  const [top, , bottom, left] = paddingSides(attrs.padding ?? page);
  return {
    background: attrs.background,
    image: attrs.image ?? null,
    padding: paddingOf(top, '0px', bottom, '0px'),
    inset: Number.parseFloat(left) || 0,
  };
}

export interface PageLayoutOptions {
  /** The fills whose dark variants the root hands over for a dark editor —
      the library's background palette by default (dark-mode.ts). */
  palette?: readonly PaletteColor[];
}

/**
 * The page layout, in the editor: the document's `pageLayout` attribute
 * (page-layout.ts) told to the editable root, which is the closest thing the
 * view has to the reader's window. The root wears `aee-page-layout` and
 * `data-page-layout="<kind>"`, and its style hands over what the host draws
 * the page with — no wrapper is added round the blocks, so every gesture
 * that works on top-level blocks works as before:
 *
 * - `--aee-page-width` — the column's width (`600px`);
 * - `--aee-page-spacing` — the page's room above and below the column (`32px`);
 * - `--aee-page-row-padding` — on a page of rows, the room round a row's
 *   blocks where the row says none of its own (`16px`);
 * - `--aee-page-background`, `--aee-page-column` — the page's and the
 *   column's colours, each left out when there is none;
 * - `--aee-page-background-dark`, `--aee-page-column-dark` — their dark
 *   variants, where the palette has one (dark-mode.ts);
 * - `--aee-page-ink` — the text the column's fill (else the page's) pairs.
 *
 * Pixels are the host's: the example app paints the column down the middle
 * of the root and lets sections run across it, as the email does.
 *
 * It keeps the top level what the page says (`fitToLayout`), in the step
 * that changed it: on a page of rows (`table`) every block stands in a row
 * (`pageRow`), so a new line never stands outside one; on any other page,
 * rows turn back into bands and blocks.
 *
 * Commands: `setPageLayout(layout | null)`.
 */
export function createPageLayout(options: PageLayoutOptions = {}): FunctionalExtension {
  const palette = options.palette ?? emailBackgroundPalette;
  return defineExtension({
    name: 'pageLayout',
    commands: () => ({
      setPageLayout: (layout: PageLayout | null): Command => setPageLayout(layout),
    }),
    plugins: () => [
      new Plugin({
        key: new PluginKey('pageLayout'),
        // Part of the step that made it: a page turned into rows comes back
        // in one undo, its runs with it.
        appendTransaction: (trs, old, state) =>
          trs.some((tr) => tr.docChanged) ? fitToLayout(state, pageLayoutOf(old)) : null,
        props: { attributes: (state) => rootAttributes(pageLayoutOf(state), palette) },
      }),
    ],
  });
}

export const PageLayoutExtension = createPageLayout();

function rootAttributes(
  layout: PageLayout | null,
  palette: readonly PaletteColor[],
): Record<string, string> {
  if (!layout) return {};
  const dark = (hex: string) =>
    palette.find((color) => color.value.toLowerCase() === hex.toLowerCase())?.dark ?? null;
  const vars: [string, string | null][] = [
    ['--aee-page-width', `${layout.width}px`],
    ['--aee-page-spacing', `${layout.spacing}px`],
  ];
  if (layout.kind === 'table') vars.push([PAGE_ROW_PADDING_VAR, `${layout.rowPadding}px`]);
  if (layout.background) {
    vars.push(['--aee-page-background', layout.background]);
    vars.push(['--aee-page-background-dark', dark(layout.background)]);
  }
  if (layout.columnBackground) {
    vars.push(['--aee-page-column', layout.columnBackground]);
    vars.push(['--aee-page-column-dark', dark(layout.columnBackground)]);
  }
  const fill = layout.columnBackground ?? layout.background;
  if (fill) vars.push(['--aee-page-ink', fillTextColor(fill)]);
  return {
    class: PAGE_LAYOUT_CLASS,
    'data-page-layout': layout.kind,
    style: vars
      .filter(([, value]) => value !== null)
      .map(([name, value]) => `${name}: ${value}`)
      .join('; '),
  };
}
