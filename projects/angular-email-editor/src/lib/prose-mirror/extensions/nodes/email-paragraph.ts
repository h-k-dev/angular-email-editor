import { setBlockType } from 'prosemirror-commands';
import { Command } from 'prosemirror-state';
import { Fragment } from 'prosemirror-model';
import { defineNode } from '../../extension';

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
 * Email flavour of the paragraph. Mail clients render the default margins of
 * `<p>` as double spacing, so email bodies use `<div>` lines instead — the
 * same model contenteditable composers (Gmail, Outlook) produce natively.
 */
export const EmailParagraph = defineNode({
  name: 'paragraph',
  spec: {
    content: 'inline*',
    group: 'block',
    attrs: {
      align: { default: null },
    },
    parseDOM: [
      // The empty-line marker first (same tags, earlier rules win): its <br>
      // is transport syntax, not content — see {@link isEmptyLineMarker}.
      {
        tag: 'p',
        getAttrs: (node) => (isEmptyLineMarker(node) ? { align: alignmentOf(node) } : false),
        getContent: () => Fragment.empty,
      },
      {
        tag: 'div',
        getAttrs: (node) => (isEmptyLineMarker(node) ? { align: alignmentOf(node) } : false),
        getContent: () => Fragment.empty,
      },
      { tag: 'p', getAttrs: (node) => ({ align: alignmentOf(node) }) },
      // Divs holding inline content are lines. Container divs do not match,
      // so the parser descends into their children instead.
      {
        tag: 'div',
        getAttrs: (node) => (hasBlockChildren(node) ? false : { align: alignmentOf(node) }),
      },
    ],
    toDOM: (node) => [
      'div',
      {
        dir: 'auto',
        ...(node.attrs['align'] && { style: `text-align: ${node.attrs['align']};` }),
      },
      0,
    ],
    // Serialization-only override (see serializeToHTML): empty lines must be
    // emitted as <div><br></div> or mail clients collapse them. The editor
    // view keeps the plain content hole — it needs it for cursor placement.
    emitDOM: (node: { childCount: number; attrs: Record<string, any> }) => {
      const attrs = node.attrs['align'] ? { style: `text-align: ${node.attrs['align']};` } : {};
      return node.childCount === 0 ? ['div', attrs, ['br']] : ['div', attrs, 0];
    },
  },

  commands: ({ schema }) => ({
    setParagraph: () => setBlockType(schema.nodes['paragraph']),
    setAlignment: (align: ParagraphAlignment) => setAlignment(align),
  }),

  keymap: ({ schema }) => ({
    'Mod-Alt-0': setBlockType(schema.nodes['paragraph']),
    // Gmail/Docs bindings; left = back to the default.
    'Mod-Shift-l': setAlignment(null),
    'Mod-Shift-e': setAlignment('center'),
    'Mod-Shift-r': setAlignment('right'),
  }),

  slashItems: ({ schema }) => [
    {
      title: 'Text',
      keywords: ['paragraph', 'plain'],
      icon: 'notes',
      command: setBlockType(schema.nodes['paragraph']),
    },
  ],
});
