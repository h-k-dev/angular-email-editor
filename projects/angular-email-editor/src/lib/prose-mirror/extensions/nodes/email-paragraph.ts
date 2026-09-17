import { setBlockType } from 'prosemirror-commands';
import { liftListItem, sinkListItem } from 'prosemirror-schema-list';
import { Command } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
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

/** Applies an alignment to every paragraph the selection touches. */
const setAlignment =
  (align: ParagraphAlignment): Command =>
  (state, dispatch) => {
    const { from, to } = state.selection;
    const paragraph = state.schema.nodes['paragraph'];
    const tr = state.tr;
    let applied = false;

    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.type !== paragraph) return true;
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, align });
      applied = true;
      return false;
    });

    if (!applied) return false;
    dispatch?.(tr.scrollIntoView());
    return true;
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

  suggestions: ({ schema }) => [
    {
      id: 'text',
      title: 'Text',
      keywords: ['paragraph', 'plain'],
      icon: 'notes',
      command: setBlockType(schema.nodes['paragraph']),
    },
  ],
});
