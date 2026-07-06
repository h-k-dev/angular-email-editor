import { Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Schema } from 'prosemirror-model';
import { defineNode } from '../../extension';

export interface ImageAttrs {
  src: string;
  alt?: string | null;
  title?: string | null;
  /** Natural display width in px, capped at {@link MAX_IMAGE_WIDTH}. */
  width?: number | null;
}

/** Email convention: wider than this overflows phones and gets Gmail-clipped
    layouts; parse and file drops both cap to it. */
export const MAX_IMAGE_WIDTH = 600;

function parseWidth(node: HTMLElement): number | null {
  const attr = parseInt(node.getAttribute('width') ?? '', 10);
  if (attr > 0) return Math.min(attr, MAX_IMAGE_WIDTH);
  const style =
    /(?:^|;)\s*max-width:\s*(\d+)px/.exec(node.getAttribute('style') ?? '') ??
    /(?:^|;)\s*width:\s*(\d+)px/.exec(node.getAttribute('style') ?? '');
  const parsed = style ? parseInt(style[1], 10) : NaN;
  return parsed > 0 ? Math.min(parsed, MAX_IMAGE_WIDTH) : null;
}

/** Reads a dropped/pasted image file into insertable attrs: data-URL source,
    alt defaulted from the filename, natural width capped for email. */
export function readImageFile(file: File): Promise<ImageAttrs> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  }).then(
    (src) =>
      new Promise<ImageAttrs>((resolve) => {
        const probe = document.createElement('img');
        const attrs = (width: number | null): ImageAttrs => ({
          src,
          alt: file.name.replace(/\.\w+$/, ''),
          width: width ? Math.min(width, MAX_IMAGE_WIDTH) : null,
        });
        probe.onload = () => resolve(attrs(probe.naturalWidth || null));
        probe.onerror = () => resolve(attrs(null));
        probe.src = src;
      }),
  );
}

function imageFiles(data: DataTransfer | null): File[] {
  return Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/'));
}

async function insertImageFiles(
  view: EditorView,
  schema: Schema,
  files: File[],
  pos: number,
): Promise<void> {
  for (const file of files) {
    const attrs = await readImageFile(file);
    if (view.isDestroyed) return;
    const node = schema.nodes['image'].create(attrs);
    view.dispatch(view.state.tr.insert(Math.min(pos, view.state.doc.content.size), node));
    pos += node.nodeSize;
  }
}

/**
 * Block image with the responsiveness-ledger hybrid sizing: the `width`
 * *attribute* for Outlook (which ignores `max-width` entirely) plus
 * `width:100%; max-width:<n>px; height:auto` for everyone else — fluid on
 * phones, capped at natural size on desktop, no media queries. `float` never
 * parses and never serializes. Dropped or pasted image files insert as
 * data-URL images (the `cid:`/attachment story is the M6 import work).
 */
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
      width: { default: null },
    },
    parseDOM: [
      {
        tag: 'img[src]',
        getAttrs: (node) => ({
          src: node.getAttribute('src'),
          alt: node.getAttribute('alt'),
          title: node.getAttribute('title'),
          width: parseWidth(node),
        }),
      },
    ],
    toDOM: (node) => {
      const { src, alt, title, width } = node.attrs;
      const style = width
        ? `width: 100%; max-width: ${width}px; height: auto;`
        : 'max-width: 100%; height: auto;';
      return [
        'img',
        {
          src,
          ...(alt && { alt }),
          ...(title && { title }),
          ...(width && { width: String(width) }),
          style,
        },
      ];
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
  plugins: ({ schema }) => [
    new Plugin({
      key: new PluginKey('imageFiles'),
      props: {
        handleDrop(view, event) {
          const files = imageFiles(event.dataTransfer);
          if (!files.length) return false;
          event.preventDefault();
          const pos =
            view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
            view.state.selection.from;
          void insertImageFiles(view, schema, files, pos);
          return true;
        },
        handlePaste(view, event) {
          const files = imageFiles(event.clipboardData);
          if (!files.length) return false;
          void insertImageFiles(view, schema, files, view.state.selection.from);
          return true;
        },
      },
    }),
  ],
});
