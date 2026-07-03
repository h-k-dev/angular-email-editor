import { defineNode } from '../../extension';

export interface ImageAttrs {
  src: string;
  alt?: string | null;
  title?: string | null;
}

export const Image = defineNode({
  name: 'image',
  spec: {
    inline: false,
    group: 'block',
    draggable: true,
    atom: true,
    attrs: {
      src: {},
      alt: { default: null },
      title: { default: null },
    },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (node) => ({
          src: node.getAttribute('src'),
          alt: node.getAttribute('alt'),
          title: node.getAttribute('title'),
        }),
      },
    ],
    toDOM: (node) => {
      const { src, alt, title } = node.attrs;
      return ['img', { src, ...(alt && { alt }), ...(title && { title }) }];
    },
  },
  commands: ({ schema }) => ({
    insertImage: (attrs: ImageAttrs) => (state, dispatch) => {
      dispatch?.(
        state.tr.replaceSelectionWith(schema.nodes['image'].create(attrs)).scrollIntoView(),
      );
      return true;
    },
  }),
});
