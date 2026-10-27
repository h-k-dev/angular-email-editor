import { Node } from 'prosemirror-model';
import { defineNode } from '../../extension';
import { fillTextColor, isFillTextColor } from '../../dual-contrast';
import { layoutMarker, markedAs } from '../../layout-marker';
import { isSafeColor, toEmailSafeColor } from '../marks/text-style';
import { pendingImageSource } from './image';
import { declaredBackground, isSectionImageUrl } from './section';
import { parsePadding } from './table';

/** The editor's spelling of the page's room round a row's blocks — the
    root's custom property (extensions/page-layout.ts), for a row with no
    padding of its own. */
export const PAGE_ROW_PADDING_VAR = '--aee-page-row-padding';

export interface PageRowAttrs {
  /** The row's fill, as hex — null for the column's. */
  readonly background: string | null;
  /** The row's text colour, as hex — null for what its fill pairs (or the
      column's text, on no fill). */
  readonly color: string | null;
  /** The room round the row's blocks, as `parsePadding` normalises it — or
      null for the page's (`rowPadding`, the column's `cellpadding`). */
  readonly padding: string | null;
  /** An image behind the row's blocks — an `http(s)` URL or a `{{ … }}`
      token (`isSectionImageUrl`) — or null. */
  readonly image?: string | null;
}

/**
 * A row of a page of rows (page-layout.ts, the `table` kind): the column
 * table's `<tr><td>` in the email, and in the editor a hidden layout
 * element — no outline, no menu, no grip — that the text simply stands in.
 * A new line stays in its row; a click below the rows starts a new one.
 *
 * **A row with a fill or an image is the page's band** ({@link isBandRow}):
 * `/section` makes one of the row the caret is in, and from then on it is
 * a band in all but name — the section grip and its menu work on it (its
 * colour, its image, and Remove, which makes it a plain row again), and
 * going back to a free column it becomes a section.
 *
 * It holds blocks, as a band does, and may say its own fill, text colour,
 * image and padding — all four sides, so a hand-coded row keeps its own
 * inset. A row that says no padding takes the page's (`rowPadding`): in the
 * email the column table's `cellpadding`, which a cell with none of its own
 * gets in every client; in the editor the root's {@link PAGE_ROW_PADDING_VAR}.
 * Its image goes out as a band's does for every client that reads CSS
 * backgrounds; Outlook's Word engine shows the fill alone.
 *
 * Emitted as a `div` marked `aee-layout-page-row` with its style, which the
 * page's column (`wrapPageLayout`) turns into its `<td>` — the marker on
 * the cell, the fill as `bgcolor` too — and the page's lift turns back.
 */
export const PageRow = defineNode({
  name: 'pageRow',
  spec: {
    content: 'block+',
    group: 'block',
    defining: true,
    isolating: true,
    attrs: {
      background: { default: null },
      color: { default: null },
      padding: { default: null },
      image: { default: null },
    },
    parseDOM: [
      {
        tag: 'div',
        // Ahead of the generic div rules: the marker says what it is.
        priority: 70,
        getAttrs: (dom) =>
          markedAs(dom as HTMLElement) === 'page-row' ? rowAttrs(dom as HTMLElement) : false,
      },
    ],
    // The page's padding, where the row says none, as the root hands it
    // over. A token image is named, not fetched: the browser would ask for
    // the token as a path.
    toDOM: (node) => {
      const attrs = node.attrs as PageRowAttrs;
      const pending = pendingImageSource(attrs.image ?? null);
      const own = attrs.padding ? '' : `padding: var(${PAGE_ROW_PADDING_VAR}, 0px); `;
      return [
        'div',
        {
          class: 'aee-page-row',
          style: own + pageRowStyle(pending ? { ...attrs, image: null } : attrs),
          ...(pending && { 'data-pending-image': pending }),
        },
        0,
      ];
    },
    emitDOM: (node: { attrs: Record<string, any> }) => {
      const style = pageRowStyle(node.attrs as PageRowAttrs);
      return ['div', { class: layoutMarker('page-row'), ...(style && { style }) }, 0];
    },
  },
});

/** Whether a row is the page's band — a fill or an image of its own. */
export function isBandRow(node: Node | null | undefined): boolean {
  return node?.type.name === 'pageRow' && !!(node.attrs['background'] || node.attrs['image']);
}

/** A row's inline style: its own padding, its fill with the text the fill
    pairs (or the row's own), or its text colour alone, and its image —
    empty for a plain row with the page's padding. */
export function pageRowStyle({ background, color, padding, image }: PageRowAttrs): string {
  const ink = color ?? (background ? fillTextColor(background) : null);
  return [
    padding ? `padding: ${padding};` : '',
    background ? `background-color: ${background};` : '',
    ink ? `color: ${ink};` : '',
    image
      ? `background-image: url('${image}'); background-position: center top; ` +
        'background-size: cover; background-repeat: no-repeat;'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function rowAttrs(el: HTMLElement): PageRowAttrs {
  const hex = (raw: string) => (raw && isSafeColor(raw) ? toEmailSafeColor(raw) : null);
  const background = hex(declaredBackground(el) || el.getAttribute('bgcolor') || '');
  const ink = el.style.color;
  // The colour a fill pairs is the fill's, not the row's own.
  const color = ink && !(background && isFillTextColor(ink, background)) ? hex(ink) : null;
  const url = /url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(el.getAttribute('style') ?? '')?.[2];
  const image = url && isSectionImageUrl(url.trim()) ? url.trim() : null;
  return { background, color, padding: parsePadding(el), image };
}
