import { defineMark } from '../../extension';
import { Plugin, PluginKey } from 'prosemirror-state';
export interface LinkAttrs {
  href: string;
  title?: string | null;
  target?: string;
}

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
      const { from, to, empty } = state.selection;
      if (empty || !isSafeUrl(attrs.href)) return false;

      dispatch?.(state.tr.addMark(from, to, schema.marks['link'].create(attrs)));
      return true;
    },
    unsetLink: () => (state, dispatch) => {
      const { from, to, empty } = state.selection;
      if (empty) return false;
      dispatch?.(state.tr.removeMark(from, to, schema.marks['link']));
      return true;
    },
  }),
  plugins: () => [linkClickPlugin],
});
