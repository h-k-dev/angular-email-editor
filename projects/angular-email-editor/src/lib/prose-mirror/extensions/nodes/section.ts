import { Command, EditorState, TextSelection } from 'prosemirror-state';
import { DOMOutputSpec, Node, Schema } from 'prosemirror-model';
import { defineNode } from '../../extension';
import { emailBackgroundPalette, fillTextColor } from '../../dual-contrast';
import { isSafeColor, toEmailSafeColor } from '../marks/text-style';
import { parsePadding } from './table';

/** How wide a section's content runs: the email's container, centred in
    the band. */
export const SECTION_CONTENT_MAX = 600;

/** A band's default breathing room, above and below — MJML's own. */
export const SECTION_PADDING = '20px 0px';

/** The content column's inline inset inside the band. */
export const SECTION_INSET = 16;

/**
 * A section: a full-width band of the email — a fill running edge to edge
 * across the reader's window with the content centred in the 600px column
 * inside it — the one layout effect a 600px table cannot produce, and what
 * makes a newsletter read as header band, hero, footer rather than one
 * white sheet. MJML's `mj-section`, rendered our way.
 *
 * **Rendered once, for every client.** MJML renders a section twice — a
 * `<div>` for the clients that read `max-width`, and the same content again
 * in a 600px table inside an Outlook-only conditional comment — because
 * Outlook's Word engine ignores `max-width` and `inline-block`. Gmail drops
 * every comment, and its app strips the head for non-Google accounts, so
 * what both keep is what this emits: one `role="presentation"` table,
 * 100% wide, its one cell carrying the fill as `bgcolor` *and* as an
 * inline `background-color` (Outlook reads the attribute, everyone else
 * the style), and inside it a `<div>` capped at 600px with auto margins.
 * Where that div cannot be honoured (Outlook) the content runs the band's
 * full width — the graceful half of the same bargain the columns block
 * strikes. Nothing here needs a stylesheet or a comment.
 *
 * **The fill pairs its text.** A filled band writes an explicit text colour
 * (`fillTextColor`), since the dark modes that flip default text keep the
 * fill; the swatches are the dual-safe background palette, so both survive
 * a forced inversion. `bgcolor` carries the same colour as hex for Outlook.
 *
 * **A background image, for both clients.** A band may carry an image
 * behind its content (MJML's `background-url`): the cell gets it as a
 * `background` attribute *and* as inline `background-image`, centred,
 * covering, not repeating — Gmail and the rest read those — with the fill
 * colour beneath for the clients that hold images back. Outlook's Word
 * engine reads neither, and draws VML: the cell's content is wrapped in a
 * `v:rect` with a `v:fill` of the image, inside `[if mso]` conditional
 * comments that every other client discards. That is the one place the
 * email carries a comment — MJML's translation of the same idea, and the
 * only way to a picture behind text in Outlook; without it the colour
 * shows, which is the fallback anyway. A band without an image emits no
 * comment at all.
 *
 * **On parse** a section is a one-cell presentation table whose cell holds
 * nothing but elements and carries a fill, an image or a padding — a
 * builder's section (MJML's, with the fill on its table or wrapping div,
 * the image as the table's `background` or a `url()` in a style) as much
 * as our own. A one-cell table with words in it is a table, and stays one.
 * Only an `http(s)` image is taken.
 */
export const Section = defineNode({
  name: 'section',
  spec: {
    content: 'block+',
    group: 'block',
    defining: true,
    isolating: true,
    attrs: {
      /** The fill, as hex — null for a band with no colour (a spacer). */
      background: { default: null },
      /** The band's padding, as `parsePadding` normalises it. */
      padding: { default: SECTION_PADDING },
      /** An image behind the content — an `http(s)` URL — or null. */
      image: { default: null },
    },
    parseDOM: [
      {
        tag: 'table',
        // Ahead of the table node's own rule (50): a band is a table too.
        priority: 60,
        getAttrs: (dom) => sectionAttrs(dom as HTMLTableElement),
        contentElement: (dom) => sectionContent(dom as HTMLTableElement),
      },
    ],
    // The editor's DOM: a band with the inner column — the layout guides'
    // class on it, which the email never sees.
    toDOM: (node) => [
      'div',
      { class: 'aee-section', style: bandStyle(node.attrs as SectionAttrs) },
      ['div', { class: 'aee-section__inner', style: innerStyle() }, 0],
    ],
    emitDOM: (node: { attrs: Record<string, any> }) => emitBand(node.attrs as SectionAttrs),
  },
  commands: ({ schema }) => ({
    insertSection: (background?: string | null): Command => insertSection(schema, background),
    /** Fill the section the cursor is in (or clear it with `null`). */
    setSectionBackground: (color: string | null): Command => setSectionBackground(color),
    /** Put an image behind the section the cursor is in (or take it away
        with `null`) — an `http(s)` URL; anything else is refused. */
    setSectionImage: (url: string | null): Command => setSectionImage(url),
    /** Take the band away, its content staying where it stood. */
    removeSection: (): Command => removeSection,
  }),
  actions: ({ schema }) => [
    {
      id: 'section',
      section: 'layout',
      title: 'Section',
      keywords: ['section', 'band', 'background', 'fill', 'row', 'block'],
      icon: 'view_agenda',
      // A new band shows itself: the palette's quiet grey.
      command: insertSection(schema, DEFAULT_FILL),
    },
  ],
});

const DEFAULT_FILL = emailBackgroundPalette.find((color) => color.name === 'Gray')?.value ?? null;

interface SectionAttrs {
  background: string | null;
  padding: string | null;
  image: string | null;
}

/** The band's inline style: its padding, its fill with the text colour
    the fill pairs, and the image behind it — centred at the top, covering
    the band, once — for every client that reads CSS backgrounds. */
const bandStyle = ({ background, padding, image }: SectionAttrs): string =>
  [
    padding ? `padding: ${padding};` : '',
    background ? `background-color: ${background}; color: ${fillTextColor(background)};` : '',
    image
      ? `background-image: url('${image}'); background-position: center top; ` +
        'background-size: cover; background-repeat: no-repeat;'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

const TABLE_ATTRS = {
  role: 'presentation',
  width: '100%',
  cellpadding: '0',
  cellspacing: '0',
  border: '0',
  style: 'width: 100%; border-collapse: collapse;',
};

/** The band as sent: one presentation table. With an image, the content is
    wrapped in VML for Outlook — comment nodes, which a DOMOutputSpec cannot
    express, so the table is then built by hand. */
function emitBand(attrs: SectionAttrs): DOMOutputSpec {
  const cellAttrs = {
    ...(attrs.background && { bgcolor: attrs.background }),
    ...(attrs.image && { background: attrs.image }),
    style: bandStyle(attrs),
  };
  if (!attrs.image) {
    return [
      'table',
      TABLE_ATTRS,
      ['tbody', ['tr', ['td', cellAttrs, ['div', { style: innerStyle() }, 0]]]],
    ];
  }
  // Styles through the CSSOM, as the spec path writes them (`cssText`), so
  // the two paths print the same colours.
  const table = document.createElement('table');
  for (const [name, value] of Object.entries(TABLE_ATTRS)) setAttribute(table, name, value);
  const td = table.createTBody().insertRow().insertCell();
  for (const [name, value] of Object.entries(cellAttrs)) setAttribute(td, name, value);
  const inner = document.createElement('div');
  inner.style.cssText = innerStyle();
  td.append(document.createComment(vmlOpen(attrs)), inner, document.createComment(VML_CLOSE));
  return { dom: table, contentDOM: inner };
}

function setAttribute(el: HTMLElement, name: string, value: string): void {
  if (name === 'style') el.style.cssText = value;
  else el.setAttribute(name, value);
}

/** Outlook's own drawing of a picture behind text: a full-width rectangle
    (`mso-width-percent: 1000` is the Word engine's "as wide as the page")
    filled with the image, the fill colour as its base, the content in a
    text box that grows with it. */
const vmlOpen = ({ image, background }: SectionAttrs): string =>
  '[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" ' +
  'style="mso-width-percent: 1000;">' +
  `<v:fill type="frame" src="${escapeAttribute(image!)}"${background ? ` color="${background}"` : ''} />` +
  '<v:textbox inset="0,0,0,0" style="mso-fit-shape-to-text: true;"><![endif]';

const VML_CLOSE = '[if mso]></v:textbox></v:rect><![endif]';

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Whether a URL may stand as a band's image: `http(s)` only — never a
    script, a data URL (Gmail shows nothing for it) or a file. */
export function isSectionImageUrl(url: string | null): url is string {
  return !!url && /^https?:\/\/\S+$/i.test(url.trim());
}

/** The section's content column: the container's width, centred, with the
    surface's inline inset inside it so words never touch the band's edge
    on a phone — `box-sizing` keeps the inset inside the cap. Outlook
    ignores padding on a div and shows the content at the band's edge,
    inside the reading pane's own margins: the graceful half. */
const innerStyle = (): string =>
  `max-width: ${SECTION_CONTENT_MAX}px; margin-left: auto; margin-right: auto; ` +
  `padding-left: ${SECTION_INSET}px; padding-right: ${SECTION_INSET}px; box-sizing: border-box;`;

/** A section's attrs off a table — or false for a table that is a table. */
function sectionAttrs(table: HTMLTableElement): Record<string, unknown> | false {
  if (table.getAttribute('role') !== 'presentation') return false;
  if (table.rows.length !== 1 || table.rows[0].cells.length !== 1) return false;
  const cell = table.rows[0].cells[0];
  const hasWords = Array.from(cell.childNodes).some(
    (node) => node.nodeType === 3 /* text */ && !!node.textContent?.trim(),
  );
  if (hasWords) return false;
  const parent = table.parentElement;
  const raw =
    declaredBackground(cell) ||
    cell.getAttribute('bgcolor') ||
    declaredBackground(table) ||
    table.getAttribute('bgcolor') ||
    // MJML puts the fill on the div wrapping the section's table.
    (parent instanceof HTMLElement && parent.tagName === 'DIV' ? declaredBackground(parent) : '') ||
    '';
  const padding = parsePadding(cell);
  const background = raw && isSafeColor(raw) ? toEmailSafeColor(raw) : null;
  const image = declaredImage(table, cell, parent);
  if (!background && !padding && !image) return false;
  return { background, padding: padding ?? SECTION_PADDING, image };
}

/** The image a builder's section carries: the table's `background`
    attribute (ours, MJML's), else a `url()` in the cell's, the table's or
    the wrapping div's `background-image` or `background` — the first
    that is an `http(s)` URL. */
function declaredImage(
  table: HTMLTableElement,
  cell: HTMLTableCellElement,
  parent: Element | null,
): string | null {
  const candidates = [table.getAttribute('background'), cell.getAttribute('background')];
  for (const el of [
    cell,
    table,
    parent instanceof HTMLElement && parent.tagName === 'DIV' ? parent : null,
  ]) {
    if (!el) continue;
    const style = el.getAttribute('style') ?? '';
    const m = /(?:^|;)\s*background(?:-image)?\s*:[^;]*?url\(\s*(['"]?)([^'")]+)\1\s*\)/i.exec(
      style,
    );
    candidates.push(m?.[2] ?? null);
  }
  const image = candidates.map((url) => url?.trim() ?? null).find(isSectionImageUrl);
  return image ?? null;
}

/** The background an element declares inline — the CSSOM's reading, else
    the attribute's own words (`background: #fff` as a builder writes it,
    which not every engine expands). */
export function declaredBackground(el: Element): string {
  const cssom = (el as HTMLElement).style?.backgroundColor;
  if (cssom) return cssom;
  const style = el.getAttribute('style') ?? '';
  const m = /(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i.exec(style);
  const value = m?.[1].trim() ?? '';
  return isSafeColor(value) ? value : '';
}

/** Where a section's content is: the centring div when the cell holds one
    (our own form), else the cell itself (a builder's). */
function sectionContent(table: HTMLTableElement): HTMLElement {
  const cell = table.rows[0].cells[0];
  // A cell written right-to-left (MJML's way to put an image on the right)
  // hands its children over in reverse — the order a client draws them in.
  if (cell.style?.direction === 'rtl') {
    for (const child of Array.from(cell.childNodes).reverse()) cell.appendChild(child);
    cell.style.direction = '';
  }
  const only = cell.children.length === 1 ? cell.children[0] : null;
  if (!(only instanceof HTMLElement) || only.tagName !== 'DIV') return cell;
  const centred =
    !!only.style?.maxWidth &&
    only.style?.marginLeft === 'auto' &&
    !/inline-block/i.test(only.style?.display ?? '');
  return centred ? only : cell;
}

/** The section around the cursor, innermost. */
export function findSectionContext(state: EditorState): { pos: number; node: Node } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'section') {
      return { pos: $from.before(d), node: $from.node(d) };
    }
  }
  return null;
}

/** Inserts a band at the selection and drops the cursor into it. */
function insertSection(schema: Schema, background: string | null = null): Command {
  return (state, dispatch) => {
    if (!dispatch) return true;
    const type = schema.nodes['section'];
    const node = type.createAndFill({ background })!;
    const from = state.selection.from;
    const tr = state.tr.replaceSelectionWith(node);
    let pos = -1;
    tr.doc.descendants((n, p) => {
      if (pos !== -1) return false;
      if (n.type.name === 'section' && p >= from - 1) pos = p;
      return pos === -1;
    });
    // section(pos) → first block(+1) → inline start(+1)
    if (pos >= 0) tr.setSelection(TextSelection.create(tr.doc, pos + 2));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Sets (or clears) the fill of the section the cursor is in. */
export function setSectionBackground(color: string | null): Command {
  return (state, dispatch) => {
    const ctx = findSectionContext(state);
    if (!ctx) return false;
    if (dispatch) {
      const background = color ? toEmailSafeColor(color) : null;
      dispatch(
        state.tr
          .setNodeMarkup(ctx.pos, undefined, { ...ctx.node.attrs, background })
          .scrollIntoView(),
      );
    }
    return true;
  };
}

/** Puts an image behind (or takes it from) the section the cursor is in.
    A URL that is not `http(s)` is refused: the command answers false. */
export function setSectionImage(url: string | null): Command {
  return (state, dispatch) => {
    const ctx = findSectionContext(state);
    if (!ctx) return false;
    const image = url ? url.trim() : null;
    if (image && !isSectionImageUrl(image)) return false;
    if (dispatch) {
      dispatch(
        state.tr.setNodeMarkup(ctx.pos, undefined, { ...ctx.node.attrs, image }).scrollIntoView(),
      );
    }
    return true;
  };
}

/** Lifts the section's content out, in its place. */
const removeSection: Command = (state, dispatch) => {
  const ctx = findSectionContext(state);
  if (!ctx) return false;
  if (dispatch) {
    const { from } = state.selection;
    const tr = state.tr.replaceWith(ctx.pos, ctx.pos + ctx.node.nodeSize, ctx.node.content);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(1, from - 1))));
    dispatch(tr.scrollIntoView());
  }
  return true;
};
