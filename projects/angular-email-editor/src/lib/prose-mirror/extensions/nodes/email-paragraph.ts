import { setBlockType } from 'prosemirror-commands';
import { liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { Command, EditorState } from 'prosemirror-state';
import { Fragment, ResolvedPos } from 'prosemirror-model';
import { isNodeActive } from '../../editor';
import { defineNode } from '../../extension';
import { findListDepth } from './lists';

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'FIGURE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
]);

function hasBlockChildren(node: HTMLElement) {
  for (const child of node.children) {
    if (BLOCK_TAGS.has(child.tagName)) return true;
  }

  return false;
}

export type ParagraphAlignment = 'center' | 'right' | null;

/** One indent level, in px — Gmail's step, and what its own indented
    messages carry, so the two round-trip into each other. */
export const INDENT_STEP = 40;

/** The deepest indent offered: eight steps are 320px, a phone screen's
    worth of margin — past that a line has no room left to say anything. */
export const INDENT_MAX = 8;

/**
 * A line whose sole content is one `<br>` — the empty-line *marker* our own
 * `emitDOM` writes (mail clients collapse a truly empty div). It must parse
 * back to an **empty** paragraph: read as a hardBreak instead, the editor
 * renders marker + its own trailing break as a double-height blank line,
 * while the serialized bytes (and thus the preview) show a single one — the
 * one honest height.
 */
function isEmptyLineMarker(node: HTMLElement): boolean {
  if (node.children.length !== 1 || node.children[0].tagName !== 'BR') return false;
  return !(node.textContent ?? '').trim();
}

/** Left is the default and canonicalizes to `null` — `text-align: left`
    never serializes, so unaligned text stays free of declarations (which
    also keeps `dir="auto"` meaningful for RTL). Justify is not offered:
    Outlook's Word engine mangles it. */
function alignmentOf(node: HTMLElement): ParagraphAlignment {
  const align = node.style?.textAlign || node.getAttribute('align');
  return align === 'center' || align === 'right' ? align : null;
}

/** The indent a line carries, in steps: its start margin in px, rounded to
    the step and capped. Only a px margin counts — an em or a percentage is
    someone else's layout, not an indent — and none canonicalizes to 0,
    which serializes to nothing. */
function indentOf(node: HTMLElement): number {
  const margin = node.style?.marginLeft || node.style?.marginInlineStart || '';
  const px = /^(\d+(?:\.\d+)?)px$/.exec(margin.trim());
  if (!px) return 0;
  return Math.min(INDENT_MAX, Math.max(0, Math.round(parseFloat(px[1]) / INDENT_STEP)));
}

function attrsOf(node: HTMLElement) {
  return { align: alignmentOf(node), indent: indentOf(node) };
}

/** The inline style a paragraph serializes with — none when it carries
    neither an alignment nor an indent. */
function styleOf(attrs: Record<string, any>): { style: string } | Record<never, never> {
  const declarations = [
    attrs['align'] && `text-align: ${attrs['align']};`,
    attrs['indent'] > 0 && `margin-left: ${attrs['indent'] * INDENT_STEP}px;`,
  ].filter(Boolean);
  return declarations.length ? { style: declarations.join(' ') } : {};
}

/**
 * The table cell the position sits in, if any — by the schema's own
 * `tableRole`, which is how prosemirror-tables marks its nodes, so nothing
 * here has to know that extension exists (a schema without tables never
 * matches, and never pays for the check).
 */
function cellAround($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.spec['tableRole'] === 'cell') return $pos.before(depth);
  }
  return null;
}

/**
 * Applies an alignment to every paragraph the selection touches — and to
 * every table cell it touches that holds no paragraph to take it.
 *
 * A cell in this schema holds inline content directly (see the table node),
 * so there is no line inside it to align: the alignment belongs to the
 * `<td>`, which is where a mail client expects to read one anyway. That makes
 * one set of Align buttons do the obvious thing everywhere — a line, a
 * selection of lines, a cell, or a shift-dragged rectangle of them — instead
 * of going dead the moment the cursor enters a table.
 *
 * The selection's own `ranges` are what is walked, not one `from`–`to` span:
 * a cell selection carries one range per selected cell, so a rectangle
 * aligns exactly the cells in it and none of the ones it reaches across.
 */
const setAlignment =
  (align: ParagraphAlignment): Command =>
  (state, dispatch) => {
    const paragraph = state.schema.nodes['paragraph'];
    const tr = state.tr;
    const cells = new Set<number>();
    let applied = false;

    for (const range of state.selection.ranges) {
      const { $from, $to } = range;
      let lines = false;
      state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
        if (node.type !== paragraph) return true;
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
        lines = true;
        applied = true;
        return false;
      });
      // Only where the range has no line of its own: a cell that does holds
      // its alignment on those, the way the rest of the document does.
      if (lines) continue;
      const cell = cellAround($from);
      if (cell !== null) cells.add(cell);
    }

    // Positions hold: `setNodeMarkup` swaps a node for one of the same size.
    for (const pos of cells) {
      const cell = tr.doc.nodeAt(pos);
      if (!cell) continue;
      tr.setNodeMarkup(pos, undefined, { ...cell.attrs, align });
      applied = true;
    }

    if (!applied) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };

/** Whether the selection is aligned that way. A line answers for itself
    wherever there is one — inside a cell too, for a host whose cells hold
    paragraphs; only where there is none does the cell answer. */
const isAligned = (state: EditorState, align: ParagraphAlignment): boolean => {
  const paragraph = state.schema.nodes['paragraph'];
  if (isNodeActive(state, paragraph)) return isNodeActive(state, paragraph, { align });
  const pos = cellAround(state.selection.$from);
  const cell = pos === null ? null : state.doc.nodeAt(pos);
  return !!cell && 'align' in cell.attrs && cell.attrs['align'] === align;
};

/**
 * Moves every paragraph the selection touches one step in (+1) or out (-1),
 * Gmail's "Indent more" / "Indent less". Inside a list the same gesture
 * nests the item or lifts it out instead — an indent there is structure,
 * not margin — so the one pair of buttons does the right thing in both
 * places. Returns false when nothing can move (the margin already, or a
 * list item that cannot nest further), so a keybinding falls through.
 */
const shiftIndent =
  (step: 1 | -1): Command =>
  (state, dispatch, view) => {
    const listItem = state.schema.nodes['listItem'];
    if (listItem && findListDepth(state.selection.$from) !== null) {
      const nest = step > 0 ? sinkListItem(listItem) : liftListItem(listItem);
      return nest(state, dispatch, view);
    }

    const { from, to } = state.selection;
    const paragraph = state.schema.nodes['paragraph'];
    const tr = state.tr;
    let applied = false;

    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type !== paragraph) return true;
      const indent = Math.min(INDENT_MAX, Math.max(0, (node.attrs['indent'] ?? 0) + step));
      if (indent !== node.attrs['indent']) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent });
        applied = true;
      }
      return false;
    });

    if (!applied) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
  };

/**
 * Email flavour of the paragraph. Mail clients render the default margins of
 * `<p>` as double spacing, so email bodies use `<div>` lines instead — the
 * same model contenteditable composers (Gmail, Outlook) produce natively.
 *
 * A line carries its alignment and its indent (in steps of
 * {@link INDENT_STEP}); both serialize as inline style, the only style mail
 * clients keep, and both stay on the next line when Enter is pressed at the
 * line's end (see `splitKeepingMarks`), as they do in Gmail.
 */
export const EmailParagraph = defineNode({
  name: 'paragraph',
  spec: {
    content: 'inline*',
    group: 'block',
    attrs: {
      align: { default: null },
      indent: { default: 0 },
    },
    parseDOM: [
      // The empty-line marker first (same tags, earlier rules win): its <br>
      // is transport syntax, not content — see {@link isEmptyLineMarker}.
      {
        tag: 'p',
        getAttrs: (node) => (isEmptyLineMarker(node) ? attrsOf(node) : false),
        getContent: () => Fragment.empty,
      },
      {
        tag: 'div',
        getAttrs: (node) => (isEmptyLineMarker(node) ? attrsOf(node) : false),
        getContent: () => Fragment.empty,
      },
      { tag: 'p', getAttrs: (node) => attrsOf(node) },
      // Divs holding inline content are lines. Container divs do not match,
      // so the parser descends into their children instead.
      {
        tag: 'div',
        getAttrs: (node) => (hasBlockChildren(node) ? false : attrsOf(node)),
      },
    ],
    toDOM: (node) => ['div', { dir: 'auto', ...styleOf(node.attrs) }, 0],
    // Serialization-only override (see serializeToHTML): empty lines must be
    // emitted as <div><br></div> or mail clients collapse them. The editor
    // view keeps the plain content hole — it needs it for cursor placement.
    emitDOM: (node: { childCount: number; attrs: Record<string, any> }) => {
      const attrs = styleOf(node.attrs);
      return node.childCount === 0 ? ['div', attrs, ['br']] : ['div', attrs, 0];
    },
  },

  commands: ({ schema }) => ({
    setParagraph: () => setBlockType(schema.nodes['paragraph']),
    setAlignment: (align: ParagraphAlignment) => setAlignment(align),
    indent: () => shiftIndent(1),
    outdent: () => shiftIndent(-1),
  }),

  keymap: ({ schema }) => ({
    'Mod-Alt-0': setBlockType(schema.nodes['paragraph']),
    // Gmail/Docs bindings; left = back to the default.
    'Mod-Shift-l': setAlignment(null),
    'Mod-Shift-e': setAlignment('center'),
    'Mod-Shift-r': setAlignment('right'),
    // Gmail/Docs bindings for the indent; in a list, Tab and Shift-Tab do
    // the same (lists.ts).
    'Mod-]': shiftIndent(1),
    'Mod-[': shiftIndent(-1),
  }),

  actions: ({ schema }) => [
    {
      id: 'text',
      title: 'Text',
      keywords: ['paragraph', 'plain'],
      icon: 'notes',
      command: setBlockType(schema.nodes['paragraph']),
    },
    ...(
      [
        ['align-left', 'Align left', 'format_align_left', null],
        ['align-center', 'Align center', 'format_align_center', 'center'],
        ['align-right', 'Align right', 'format_align_right', 'right'],
      ] as const
    ).map(([id, title, icon, align]) => ({
      id,
      title,
      keywords: ['align', 'alignment'],
      icon,
      command: setAlignment(align),
      isActive: (state: EditorState) => isAligned(state, align),
    })),
    // Gmail's pair: a paragraph moves by a step of margin, a list item nests
    // or lifts. Whether one can move right now is the command's own answer.
    {
      id: 'indent',
      title: 'Indent more',
      keywords: ['indent', 'nest', 'tab'],
      icon: 'format_indent_increase',
      command: shiftIndent(1),
    },
    {
      id: 'outdent',
      title: 'Indent less',
      keywords: ['outdent', 'unindent', 'lift'],
      icon: 'format_indent_decrease',
      command: shiftIndent(-1),
    },
  ],
});
