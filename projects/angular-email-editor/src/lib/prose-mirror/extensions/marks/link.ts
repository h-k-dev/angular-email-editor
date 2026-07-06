import { defineMark } from '../../extension';
import { EditorState, Plugin, PluginKey } from 'prosemirror-state';
import { Mark } from 'prosemirror-model';
import { InputRule } from 'prosemirror-inputrules';

export interface LinkAttrs {
  href: string;
  title?: string | null;
  target?: string;
}

export interface LinkRange {
  from: number;
  to: number;
  attrs: LinkAttrs;
}

/** The contiguous extent of the link at `pos`, if any — the range that a
    link edit from a bare cursor (no selection) applies to. */
export function linkRangeAt(state: EditorState, pos: number): LinkRange | null {
  const type = state.schema.marks['link'];
  if (!type) return null;

  const $pos = state.doc.resolve(pos);
  const parentStart = $pos.start();
  const children: { from: number; to: number; mark: Mark | null }[] = [];
  $pos.parent.forEach((child, offset) => {
    children.push({
      from: parentStart + offset,
      to: parentStart + offset + child.nodeSize,
      mark: type.isInSet(child.marks) ?? null,
    });
  });

  const index = children.findIndex((c) => c.mark && pos >= c.from && pos <= c.to);
  if (index < 0) return null;

  // Expand over adjacent nodes carrying the same link (same href etc.).
  const mark = children[index].mark!;
  let from = children[index].from;
  let to = children[index].to;
  for (let i = index - 1; i >= 0 && children[i].mark?.eq(mark); i--) from = children[i].from;
  for (let i = index + 1; i < children.length && children[i].mark?.eq(mark); i++) to = children[i].to;

  return { from, to, attrs: mark.attrs as LinkAttrs };
}

/** A URL typed in prose, committed by the following space. */
const AUTO_LINK = /(?:^|\s)((?:https?:\/\/|www\.)[^\s]+)\s$/;

// A simple security check to prevent XSS
function isSafeUrl(url: string | null): boolean {
  if (!url) return false;
  // Block javascript: and vbscript: protocols (case-insensitive, ignoring leading spaces)
  const isMalicious = /^\s*(javascript|vbscript):/i.test(url);
  return !isMalicious;
}

export const linkClickPlugin = new Plugin({
  key: new PluginKey('linkClick'),
  props: {
    // Listen to all click events inside the editor
    handleClick: (view, pos, event) => {
      // 1. Check if the user is holding Ctrl (Windows) or Cmd (Mac)
      // If not, return false to let ProseMirror handle standard cursor placement
      if (!event.ctrlKey && !event.metaKey) {
        return false;
      }

      // 2. See if the element they clicked on is an <a> tag
      const target = event.target as HTMLElement;
      const link = target.closest('a');

      // 3. If it is a link, manually open it!
      if (link && link.href) {
        window.open(link.href, '_blank', 'noopener,noreferrer');

        // Return true to tell ProseMirror "We handled this click, do nothing else"
        return true;
      }

      return false;
    },
  },
});

export const Link = defineMark({
  name: 'link',
  spec: {
    attrs: {
      href: {},
      title: { default: null },
      target: { default: '_blank' }, // Force new tabs
      rel: { default: 'noopener noreferrer' }, // Security best practice for _blank
    },
    inclusive: false,
    // A Shift-Enter inside a link shouldn't drag the link onto the next line.
    splittable: false,
    parseDOM: [
      {
        tag: 'a[href]',
        getAttrs: (node) => {
          const href = node.getAttribute('href');

          // If the link is dangerous, reject the mark entirely
          if (!isSafeUrl(href)) return false;

          return {
            href,
            title: node.getAttribute('title'),
            target: node.getAttribute('target') || '_blank',
          };
        },
      },
    ],
    toDOM: (mark) => {
      const { href, title, target, rel } = mark.attrs;
      // Output the safe attributes
      return [
        'a',
        {
          href,
          title,
          target,
          rel,
          style: 'color: var(--mat-sys-primary,#0056b3); text-decoration: underline;',
        },
        0,
      ];
    },
  },
  commands: ({ schema }) => ({
    setLink: (attrs: LinkAttrs) => (state, dispatch) => {
      if (!isSafeUrl(attrs.href)) return false;

      // A bare cursor inside an existing link edits that whole link.
      let { from, to } = state.selection;
      if (state.selection.empty) {
        const range = linkRangeAt(state, from);
        if (!range) return false;
        ({ from, to } = range);
      }
      dispatch?.(state.tr.addMark(from, to, schema.marks['link'].create(attrs)));
      return true;
    },
    unsetLink: () => (state, dispatch) => {
      let { from, to } = state.selection;
      if (state.selection.empty) {
        const range = linkRangeAt(state, from);
        if (!range) return false;
        ({ from, to } = range);
      }
      dispatch?.(state.tr.removeMark(from, to, schema.marks['link']));
      return true;
    },
  }),
  inputRules: ({ schema }) => [
    // Auto-link: "see https://x.io " links the URL as the space commits it.
    // Trailing punctuation stays outside ("(see https://x.io)." style).
    new InputRule(AUTO_LINK, (state, match, start, end) => {
      const type = schema.marks['link'];
      const url = match[1].replace(/[.,!?;:)\]]+$/, '');
      if (!url) return null;

      const urlStart = start + match[0].indexOf(match[1]);
      const urlEnd = urlStart + url.length;
      if (state.doc.rangeHasMark(urlStart, urlEnd, type)) return null;

      const href = url.toLowerCase().startsWith('www.') ? `https://${url}` : url;
      if (!isSafeUrl(href)) return null;

      // The committing space is not in the doc yet — the rule inserts it.
      return state.tr.insertText(' ', end).addMark(urlStart, urlEnd, type.create({ href }));
    }),
  ],
  plugins: () => [linkClickPlugin],
});
