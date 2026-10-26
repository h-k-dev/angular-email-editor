import { NodeRange } from 'prosemirror-model';
import { Command, EditorState, Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { FunctionalExtension, defineExtension } from '../extension';
import { PaletteColor, emailBackgroundPalette, fillTextColor } from '../dual-contrast';
import {
  PAGE_COLUMN_INSET,
  PageLayout,
  normalizePageLayout,
  samePageLayout,
} from '../page-layout';

/** Editor root class while the document has a page layout. */
export const PAGE_LAYOUT_CLASS = 'aee-page-layout';

/** The document's page layout (page-layout.ts), or null. */
export function pageLayoutOf(state: EditorState): PageLayout | null {
  return normalizePageLayout(state.doc.attrs['pageLayout']);
}

/** Sets the page layout — normalised (page-layout.ts) — or takes it away
    with `null`. One step, so undo puts the page back as it was. False when
    that is what it already is, and for a page of rows (`table`) asked to be
    anything else: rows do not go back to a free column (page-layout.ts). */
export const setPageLayout =
  (layout: PageLayout | null): Command =>
  (state, dispatch) => {
    const next = normalizePageLayout(layout);
    const current = pageLayoutOf(state);
    if (samePageLayout(next, current)) return false;
    if (current?.kind === 'table' && next?.kind !== 'table') return false;
    dispatch?.(state.tr.setDocAttribute('pageLayout', next));
    return true;
  };

/** Whether the document is a page of rows (the `table` kind). */
export function isRowsPage(state: EditorState): boolean {
  return pageLayoutOf(state)?.kind === 'table';
}

/** A plain row's padding: the column's inset above and below, as a free
    column's run has it — so a run turned row reads as it did. */
const ROW_PADDING = `${PAGE_COLUMN_INSET}px 0px`;

/** A page of rows keeps every top-level block in a row: the blocks that
    stand between rows — a free column's runs as the page turns into rows,
    a paste, a block dropped between two — go into a plain row (a section
    with no fill), a run of them each. Null when every block is in one. */
function keepInRows(state: EditorState): Transaction | null {
  const row = state.schema.nodes['section'];
  if (!row || !isRowsPage(state)) return null;
  const runs: [number, number][] = [];
  let start = -1;
  state.doc.forEach((node, offset) => {
    if (node.type !== row) {
      if (start < 0) start = offset;
    } else if (start >= 0) {
      runs.push([start, offset]);
      start = -1;
    }
  });
  if (start >= 0) runs.push([start, state.doc.content.size]);
  if (!runs.length) return null;
  const tr = state.tr;
  // From the end, so the positions before each run stand.
  for (const [from, to] of runs.reverse()) {
    if (!row.validContent(tr.doc.slice(from, to).content)) continue;
    const range = new NodeRange(tr.doc.resolve(from), tr.doc.resolve(to), 0);
    tr.wrap(range, [{ type: row, attrs: { padding: ROW_PADDING } }]);
  }
  return tr.docChanged ? tr : null;
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
 * - `--aee-page-background`, `--aee-page-column` — the page's and the
 *   column's colours, each left out when there is none;
 * - `--aee-page-background-dark`, `--aee-page-column-dark` — their dark
 *   variants, where the palette has one (dark-mode.ts);
 * - `--aee-page-ink` — the text the column's fill (else the page's) pairs.
 *
 * Pixels are the host's: the example app paints the column down the middle
 * of the root and lets sections run across it, as the email does.
 *
 * On a page of rows (`table`) it keeps every top-level block in a row — a
 * section, filled or plain — so a new line never stands outside one: what
 * lands between rows goes into a plain row of its own, in the same step.
 *
 * Commands: `setPageLayout(layout | null)` — into rows, never out of them.
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
        appendTransaction: (trs, _old, state) =>
          trs.some((tr) => tr.docChanged) ? keepInRows(state) : null,
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
