import { Command, EditorState, TextSelection } from 'prosemirror-state';
import { Node, Schema } from 'prosemirror-model';
import { defineNode } from '../../extension';

/**
 * Responsive layout columns — the fluid, no-media-query answer to MJML. Each
 * column is an `inline-block` div with `width: 100%` capped by a `max-width`
 * of `container / n`: on a wide screen the caps let the columns sit side by
 * side; on a phone `width: 100%` wins and they stack. `box-sizing: border-box`
 * keeps the gutter padding inside the cap so the row never overflows. Outlook
 * (which ignores `inline-block`) simply stacks them — the same graceful,
 * phone-first result. All longhand + fixed px, so it round-trips deterministic.
 */
const CONTAINER_MAX = 600;
const CONTAINER_STYLE = `width: 100%; max-width: ${CONTAINER_MAX}px;`;

const columnStyle = (maxWidth: number): string =>
  `display: inline-block; width: 100%; max-width: ${maxWidth}px; ` +
  `vertical-align: top; box-sizing: border-box; padding-left: 8px; padding-right: 8px;`;

const columnMaxWidth = (count: number): number => Math.floor(CONTAINER_MAX / count);

function parseColumnMaxWidth(style: string | null): number {
  const m = /max-width:\s*(\d+)px/.exec(style ?? '');
  return m ? +m[1] : columnMaxWidth(2);
}

/** A single column: an `inline-block` div, recognised on parse by that style
    (a `<div>`, so it never collides with the inline-block button `<a>`). */
export const Column = defineNode({
  name: 'column',
  spec: {
    content: 'block+',
    isolating: true,
    attrs: { maxWidth: { default: columnMaxWidth(2) } },
    parseDOM: [
      {
        tag: 'div',
        priority: 55,
        getAttrs: (dom) => {
          const style = (dom as HTMLElement).getAttribute('style') ?? '';
          if (!/display:\s*inline-block/i.test(style)) return false;
          return { maxWidth: parseColumnMaxWidth(style) };
        },
      },
    ],
    toDOM: (node) => ['div', { style: columnStyle(node.attrs['maxWidth']) }, 0],
  },
});

/** The column container: a plain `<div>` whose direct children are column
    divs. The child check discriminates it from an ordinary paragraph div. */
export const Columns = defineNode({
  name: 'columns',
  spec: {
    content: 'column+',
    group: 'block',
    isolating: true,
    parseDOM: [
      {
        tag: 'div',
        priority: 60,
        getAttrs: (dom) => (hasColumnChildren(dom as HTMLElement) ? {} : false),
      },
    ],
    toDOM: () => ['div', { style: CONTAINER_STYLE }, 0],
  },
  commands: ({ schema }) => ({
    insertColumns: (count = 2): Command => insertColumns(schema, count),
  }),
  keymap: () => ({ ArrowDown: escapeColumnsDown }),
  slashItems: ({ schema }) => [
    {
      title: 'Columns',
      keywords: ['columns', 'column', 'layout', 'grid', 'side by side'],
      icon: 'view_column',
      command: insertColumns(schema, 2),
    },
    {
      title: '3 columns',
      keywords: ['columns', 'three', 'layout'],
      icon: 'view_column',
      command: insertColumns(schema, 3),
    },
  ],
});

function hasColumnChildren(dom: HTMLElement): boolean {
  for (const child of Array.from(dom.children)) {
    if (
      child.tagName === 'DIV' &&
      /display:\s*inline-block/i.test(child.getAttribute('style') ?? '')
    ) {
      return true;
    }
  }
  return false;
}

/** Inserts an n-column block and drops the cursor into the first column. */
function insertColumns(schema: Schema, count: number): Command {
  return (state, dispatch) => {
    const colType = schema.nodes['column'];
    const columnsType = schema.nodes['columns'];
    const maxWidth = columnMaxWidth(count);
    const columns = Array.from({ length: count }, () => colType.createAndFill({ maxWidth })!);
    const node = columnsType.create(null, columns);
    if (!dispatch) return true;

    const from = state.selection.from;
    const tr = state.tr.replaceSelectionWith(node);
    let pos = -1;
    tr.doc.descendants((n, p) => {
      if (pos !== -1) return false;
      if (n.type.name === 'columns' && p >= from - 1) pos = p;
      return pos === -1;
    });
    if (pos >= 0) {
      // columns(pos) → column(+1) → first block(+1) → inline start(+1)
      tr.setSelection(TextSelection.create(tr.doc, pos + 3));
    }
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** ArrowDown from the end of a column's last block escapes to a paragraph
    below the columns block, creating one when it is the last node — so you
    can always write underneath (mirrors the table's escape). */
const escapeColumnsDown: Command = (state, dispatch) => {
  const { $from } = state.selection;
  let columnDepth = -1;
  let columnsDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'column' && columnDepth < 0) columnDepth = d;
    if ($from.node(d).type.name === 'columns') {
      columnsDepth = d;
      break;
    }
  }
  if (columnsDepth < 0 || columnDepth < 0) return false;

  const column = $from.node(columnDepth);
  if ($from.index(columnDepth) !== column.childCount - 1) return false; // not the last block
  if ($from.parentOffset !== $from.parent.content.size) return false; // not at its end

  const columnsEnd = $from.before(columnsDepth) + $from.node(columnsDepth).nodeSize;
  if (state.doc.resolve(columnsEnd).nodeAfter) return false; // a block already follows

  if (dispatch) {
    const paragraph = state.schema.nodes['paragraph'].createAndFill();
    if (!paragraph) return false;
    const tr = state.tr.insert(columnsEnd, paragraph);
    tr.setSelection(TextSelection.create(tr.doc, columnsEnd + 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** Exposed for the app to detect when the cursor is inside a columns block. */
export function findColumnsContext(state: EditorState): { pos: number; node: Node } | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'columns') {
      return { pos: $from.before(d), node: $from.node(d) };
    }
  }
  return null;
}
