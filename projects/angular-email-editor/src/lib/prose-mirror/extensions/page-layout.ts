import { Command, EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { FunctionalExtension, defineExtension } from '../extension';
import { PaletteColor, emailBackgroundPalette, fillTextColor } from '../dual-contrast';
import { PageLayout, normalizePageLayout, samePageLayout } from '../page-layout';

/** Editor root class while the document has a page layout. */
export const PAGE_LAYOUT_CLASS = 'aee-page-layout';

/** The document's page layout (page-layout.ts), or null. */
export function pageLayoutOf(state: EditorState): PageLayout | null {
  return normalizePageLayout(state.doc.attrs['pageLayout']);
}

/** Sets the page layout — normalised (page-layout.ts) — or takes it away
    with `null`. One step, so undo puts the page back as it was. False when
    that is what it already is. */
export const setPageLayout =
  (layout: PageLayout | null): Command =>
  (state, dispatch) => {
    const next = normalizePageLayout(layout);
    if (samePageLayout(next, pageLayoutOf(state))) return false;
    dispatch?.(state.tr.setDocAttribute('pageLayout', next));
    return true;
  };

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
 * - `--aee-page-background`, `--aee-page-column` — the page's and the
 *   column's colours, each left out when there is none;
 * - `--aee-page-background-dark`, `--aee-page-column-dark` — their dark
 *   variants, where the palette has one (dark-mode.ts);
 * - `--aee-page-ink` — the text the column's fill (else the page's) pairs.
 *
 * Pixels are the host's: the example app paints the column down the middle
 * of the root and lets sections run across it, as the email does.
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
  const vars: [string, string | null][] = [['--aee-page-width', `${layout.width}px`]];
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
