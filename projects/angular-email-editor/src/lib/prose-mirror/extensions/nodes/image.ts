import { NodeSelection, Plugin, PluginKey } from 'prosemirror-state';
import { EditorView, NodeView } from 'prosemirror-view';
import { DOMSerializer, Node, Schema } from 'prosemirror-model';
import { defineNode } from '../../extension';
import { isSafeUrl } from '../marks/link';

export interface ImageAttrs {
  /** `null` is a placeholder: a sized frame awaiting its file (see the
      NodeView) — serialized as an `<img>` without `src`, linted as unfilled. */
  src: string | null;
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

/**
 * The drop-claim rule (decided 2026-09-02): the editor takes a file drop only
 * when *every* file is an image. Pure images are content and embed inline;
 * a mixed drop — an image alongside a PDF, say — is an attachment gesture,
 * so the editor leaves the event untouched and it bubbles *whole* to the
 * host's dropzone. Nothing to decide, nothing silently lost: the host
 * attaches everything, and may still embed the images itself via
 * `readImageFile` + `insertImage` if it wants to.
 */
export function claimedImageFiles(files: Iterable<File>): File[] {
  const list = Array.from(files);
  return list.length && list.every((file) => file.type.startsWith('image/')) ? list : [];
}

function imageFiles(data: DataTransfer | null): File[] {
  return claimedImageFiles(data?.files ?? []);
}

/** The claim rule read off a drag in flight: during `dragover` a browser
    exposes file *types* only, no files. An image drag is one where every
    file item is an image; a type the browser withholds counts as one, so the
    line errs on showing. A mixed drag shows nothing here — the host's zone
    takes it. */
function isImageDrag(data: DataTransfer | null): boolean {
  const items = Array.from(data?.items ?? []).filter((item) => item.kind === 'file');
  if (items.length) return items.every((item) => !item.type || item.type.startsWith('image/'));
  return Array.from(data?.types ?? []).includes('Files');
}

export interface ImageDropTarget {
  /** The caret — the image is inserted inline where the cursor sits (Gmail's
      rule: the pointer only says the drag is over the editor). */
  pos: number;
  /** The drop line on screen: the bottom of the visual line the image is
      about to join, spanning that line's block. */
  top: number;
  left: number;
  width: number;
}

function rectOf(view: EditorView, pos: number): DOMRect | null {
  const dom = view.nodeDOM(pos) as HTMLElement | null;
  return dom && typeof dom.getBoundingClientRect === 'function'
    ? dom.getBoundingClientRect()
    : null;
}

/** Where an image drag drops — the caret, exactly what the drop uses — and
    the line to draw for it: under the visual line the caret is on (the
    caret's own box gives the line's bottom, the surrounding block its
    width). Gmail's rule: the image lands where the cursor sat before the
    drag; the pointer decides only that the drag is over the editor. */
export function imageDropTarget(view: EditorView): ImageDropTarget {
  const pos = view.state.selection.from;
  const caret = view.coordsAtPos(pos);
  const $pos = view.state.doc.resolve(pos);
  const box = ($pos.depth ? rectOf(view, $pos.before()) : null) ?? view.dom.getBoundingClientRect();
  return { pos, top: caret.bottom, left: box.left, width: box.width };
}

/**
 * The drop line — editor-only, the app owns the pixels through the
 * `aee-drop-line` class: a horizontal line under the caret's visual line —
 * where the image will land, wherever the pointer is. Positioned the way
 * prosemirror-dropcursor positions itself — absolutely, against the editor's
 * offset parent — so it never enters the document or the DOM ProseMirror
 * manages. Shown only for drags the editor would claim (see `isImageDrag`).
 */
class ImageDropLine {
  private element: HTMLElement | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners: [keyof HTMLElementEventMap, (event: DragEvent) => void][];

  constructor(private readonly view: EditorView) {
    this.listeners = [
      ['dragover', (event) => this.onDragOver(event)],
      ['dragleave', (event) => this.onDragLeave(event)],
      ['drop', () => this.hide()],
      ['dragend', () => this.hide()],
    ];
    for (const [name, listener] of this.listeners) {
      view.dom.addEventListener(name, listener as EventListener);
    }
  }

  destroy(): void {
    for (const [name, listener] of this.listeners) {
      this.view.dom.removeEventListener(name, listener as EventListener);
    }
    this.hide();
  }

  private onDragOver(event: DragEvent): void {
    if (!this.view.editable || !isImageDrag(event.dataTransfer)) return this.hide();
    this.show(imageDropTarget(this.view));
    // A drag the browser never ends for us (a lost dragleave) must not leave
    // the line behind — dropcursor's safety net.
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.hide(), 5000);
  }

  private onDragLeave(event: DragEvent): void {
    const into = event.relatedTarget as globalThis.Node | null;
    if (event.target === this.view.dom || !into || !this.view.dom.contains(into)) this.hide();
  }

  private show(target: ImageDropTarget): void {
    const parent = (this.view.dom.offsetParent as HTMLElement | null) ?? document.body;
    if (!this.element) {
      this.element = document.createElement('div');
      this.element.className = 'aee-drop-line';
      parent.appendChild(this.element);
    }
    let parentLeft: number;
    let parentTop: number;
    if (parent === document.body && getComputedStyle(parent).position === 'static') {
      parentLeft = -window.scrollX;
      parentTop = -window.scrollY;
    } else {
      const rect = parent.getBoundingClientRect();
      parentLeft = rect.left - parent.scrollLeft;
      parentTop = rect.top - parent.scrollTop;
    }
    this.element.style.left = `${target.left - parentLeft}px`;
    this.element.style.top = `${target.top - parentTop}px`;
    this.element.style.width = `${target.width}px`;
  }

  private hide(): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = null;
    this.element?.remove();
    this.element = null;
  }
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
    const tr = view.state.tr.insert(Math.min(pos, view.state.doc.content.size), node);
    view.dispatch(tr);
    // Past whatever was inserted: at a block boundary the transform wraps the
    // inline image into a line of its own, so the growth is not the node's size.
    pos = tr.mapping.map(pos);
  }
}

/** Opens the OS file picker for images and resolves with the choice (a
    cancelled dialog never resolves — the browser does not tell). */
function pickImageFiles(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []).filter((file) => file.type.startsWith('image/')));
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Opens the OS file picker and inserts the chosen image(s) at the cursor —
    the slash-menu path, mirroring what drop and paste already do. */
function pickAndInsertImages(view: EditorView, schema: Schema): void {
  void pickImageFiles(true).then((files) => {
    if (files.length && !view.isDestroyed) {
      void insertImageFiles(view, schema, files, view.state.selection.from);
    }
  });
}

/** Floor for a resized image: below this a pad has nothing left to grab. */
export const MIN_IMAGE_WIDTH = 40;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** The content width of the block an image sits in — the line's ceiling for
    a resize. 0 when unmeasurable (jsdom), and the caller falls back to the
    email maximum. */
function lineWidth(wrapper: HTMLElement): number {
  const block = wrapper.parentElement;
  if (!block) return 0;
  const style = getComputedStyle(block);
  const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
  return Math.round(block.clientWidth - padding);
}

/** Width a fresh placeholder opens at — the ledger's phone width; the pads
    take it from there. */
export const PLACEHOLDER_WIDTH = 320;

/** A placeholder keeps the frame its author sized: the picked file supplies
    the source (and the alt when the placeholder has none); `width` stays. */
export function filledPlaceholderAttrs(placeholder: ImageAttrs, picked: ImageAttrs): ImageAttrs {
  return {
    ...placeholder,
    src: picked.src,
    alt: placeholder.alt ?? picked.alt ?? null,
    width: placeholder.width ?? picked.width ?? null,
  };
}

/**
 * The image's editor-only wrapper — `span.aee-image > img`, a NodeView. The
 * `<img>` inside is exactly `toDOM` (one source of truth; the serializer and
 * the clipboard never see the span). The wrapper exists because an `<img>`
 * cannot carry an overlay: a click makes the image the node selection, the
 * wrapper carries `ProseMirror-selectednode`, and the app paints the
 * selection there — the tint and the outline. Attribute changes update the
 * `<img>` in place.
 *
 * The wrapper also carries the **resize pads**: two pads inset on the left
 * and right edges, shown on hover and on the selected image (the app's CSS).
 * A drag on an unselected image works too and leaves it selected. Dragging
 * a pad draws only a primary *frame* at the would-be size; the real resize
 * — a `width` write, clamped between {@link MIN_IMAGE_WIDTH} and the line's
 * own width (never past {@link MAX_IMAGE_WIDTH}), so at the ceiling the
 * image fills the line and the next caret position is the next line —
 * happens once, on release (`ColumnsResize`'s deferred commit). The ratio
 * is kept by construction: only `width` is ever written, and the serialized
 * style keeps `height: auto`. Pad presses never reach ProseMirror
 * (`stopEvent`), so a resize is never mistaken for a node drag or a click.
 *
 * A **placeholder** — an image with no `src` — renders as a dashed frame
 * (`span.aee-image__placeholder`, the app owns the pixels) with the same
 * pads: size the frame first, then click it to pick the file that fills it
 * ({@link filledPlaceholderAttrs} keeps the frame's width). The slide-deck
 * model — Keynote's media placeholder — and the image counterpart of the
 * merge tag.
 */
class ImageView implements NodeView {
  readonly dom: HTMLSpanElement;
  private img: HTMLElement;
  private readonly frame: HTMLSpanElement;
  /** A resize that just ended: the browser fires a click for a press on a
      pad released over the wrapper, and that click must not open the
      picker. */
  private resized = false;

  constructor(
    private node: Node,
    private readonly view: EditorView,
    private readonly getPos: () => number | undefined,
  ) {
    this.dom = document.createElement('span');
    this.dom.className = 'aee-image';
    this.apply(node);
    this.img = ImageView.render(node);
    this.dom.appendChild(this.img);
    for (const side of ['left', 'right'] as const) {
      const pad = document.createElement('span');
      pad.className = `aee-image__pad aee-image__pad--${side}`;
      pad.addEventListener('pointerdown', (event) => this.startResize(side, event));
      this.dom.appendChild(pad);
    }
    this.frame = document.createElement('span');
    this.frame.className = 'aee-image__frame';
    this.dom.appendChild(this.frame);
    this.dom.addEventListener('click', (event) => this.onClick(event));
  }

  private static render(node: Node): HTMLElement {
    if (!node.attrs['src']) {
      const box = document.createElement('span');
      box.className = 'aee-image__placeholder';
      box.setAttribute('role', 'button');
      box.textContent = 'Choose an image';
      return box;
    }
    return DOMSerializer.renderSpec(document, node.type.spec.toDOM!(node)).dom as HTMLElement;
  }

  update(node: Node): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    const img = ImageView.render(node);
    this.img.replaceWith(img);
    this.img = img;
    this.apply(node);
    return true;
  }

  /** The wrapper is shrink-to-fit, and a percentage width inside a
      shrink-to-fit box resolves against the image's *natural* size — so a
      cap above it (an enlarged image) would never show in the editor while
      the sent email honours it. The wrapper therefore carries the cap
      itself, fluid below it through the app's `max-width: 100%`: exactly
      the box `width: 100%; max-width: <n>px` resolves to in the recipient's
      container. No cap → shrink-to-fit, the natural size, as in the email.
      A placeholder is flagged for the app's frame styling. */
  private apply(node: Node): void {
    const width = node.attrs['width'] as number | null;
    this.dom.style.width = width ? `${width}px` : '';
    this.dom.classList.toggle('aee-image--placeholder', !node.attrs['src']);
  }

  selectNode(): void {
    this.dom.classList.add('ProseMirror-selectednode');
  }

  deselectNode(): void {
    this.dom.classList.remove('ProseMirror-selectednode');
  }

  /** The pads are ours: a press on one must not become ProseMirror's node
      drag or click. */
  stopEvent(event: Event): boolean {
    const target = event.target as Element | null;
    return !!target?.closest?.('.aee-image__pad');
  }

  /** A click on a placeholder opens the picker; the picked file fills the
      frame in place and leaves it selected. Pads and a just-finished resize
      are not clicks. */
  private onClick(event: MouseEvent): void {
    if (this.node.attrs['src'] || this.resized) return;
    if ((event.target as Element | null)?.closest?.('.aee-image__pad')) return;
    void pickImageFiles(false).then(async ([file]) => {
      if (!file || this.view.isDestroyed) return;
      const picked = await readImageFile(file);
      const pos = this.getPos();
      if (pos === undefined || this.view.isDestroyed) return;
      const attrs = filledPlaceholderAttrs(this.node.attrs as ImageAttrs, picked);
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, attrs);
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      this.view.dispatch(tr);
    });
  }

  private startResize(side: 'left' | 'right', event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = this.img.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = rect.height / rect.width;
    const startX = event.clientX;
    const startWidth = Math.round(rect.width);
    let width = startWidth;
    // The line is the ceiling: at it the image fills the line and the next
    // caret position is the next line — and never past the email maximum.
    const line = lineWidth(this.dom);
    const max = line > 0 ? Math.min(MAX_IMAGE_WIDTH, line) : MAX_IMAGE_WIDTH;
    this.resized = true;

    const preview = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      width = clamp(
        Math.round(rect.width + (side === 'right' ? delta : -delta)),
        MIN_IMAGE_WIDTH,
        max,
      );
      this.frame.style.width = `${width}px`;
      this.frame.style.height = `${Math.round(width * ratio)}px`;
    };
    const finish = () => {
      window.removeEventListener('pointermove', preview);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      this.dom.classList.remove('aee-image--resizing', `aee-image--resizing-${side}`);
      this.frame.removeAttribute('style');
      // The click for this press, if any, fires before this timeout.
      setTimeout(() => (this.resized = false), 0);
      const pos = this.getPos();
      if (pos === undefined || width === startWidth) return;
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width });
      tr.setSelection(NodeSelection.create(tr.doc, pos));
      this.view.dispatch(tr);
    };

    this.dom.classList.add('aee-image--resizing', `aee-image--resizing-${side}`);
    preview(event);
    window.addEventListener('pointermove', preview);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  }
}

/**
 * Inline image — Gmail's and Proton's model (decided 2026-09-02): the image
 * sits in the text line like a character, so the caret can stand right
 * beside it at the image's height and typing continues next to it. The
 * serialized form is then Gmail's own (`<div><img …></div>` for an image on
 * a line of its own), which is as safe as email HTML gets. Sizing is the
 * responsiveness-ledger hybrid: the `width`
 * *attribute* for Outlook (which ignores `max-width` entirely) plus
 * `width:100%; max-width:<n>px; height:auto` for everyone else — fluid on
 * phones, capped at natural size on desktop, no media queries. `float` never
 * parses and never serializes. Dropped or pasted image files insert as
 * data-URL images — what a browser editor can hold on its own; the send
 * intent promotes them to `cid:` parts (`promoteInlineImages`), and the
 * source pane lints them until then. Which drops the editor claims at all
 * is {@link claimedImageFiles}: all images, or none.
 */
export const Image = defineNode({
  name: 'image',
  spec: {
    inline: true,
    group: 'inline',
    draggable: true,
    atom: true,
    attrs: {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
    },
    parseDOM: [
      {
        // Any <img>: one without a source (or with an empty one) is a
        // placeholder — a sized frame awaiting its file.
        tag: 'img',
        getAttrs: (node) => {
          const src = node.getAttribute('src') || null;
          // Same rule as the link mark: a script URL kills the node on parse.
          if (src && !isSafeUrl(src)) return false;
          return {
            src,
            alt: node.getAttribute('alt'),
            title: node.getAttribute('title'),
            width: parseWidth(node),
          };
        },
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
          ...(src && { src }),
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
      if (attrs.src && !isSafeUrl(attrs.src)) return false;
      dispatch?.(
        state.tr.replaceSelectionWith(schema.nodes['image'].create(attrs)).scrollIntoView(),
      );
      return true;
    },
  }),
  slashItems: ({ schema }) => [
    {
      title: 'Image',
      keywords: ['image', 'picture', 'photo', 'img'],
      icon: 'image',
      command: (_state, _dispatch, view) => {
        if (view) pickAndInsertImages(view, schema);
        return true;
      },
    },
    {
      // The slide-deck model: size the frame first, click it to fill it.
      title: 'Image placeholder',
      keywords: ['placeholder', 'image', 'frame', 'slot', 'picture'],
      icon: 'add_photo_alternate',
      command: (state, dispatch) => {
        dispatch?.(
          state.tr
            .replaceSelectionWith(schema.nodes['image'].create({ width: PLACEHOLDER_WIDTH }))
            .scrollIntoView(),
        );
        return true;
      },
    },
  ],
  plugins: ({ schema }) => [
    new Plugin({
      key: new PluginKey('imageFiles'),
      props: {
        handleDrop(view, event) {
          const files = imageFiles(event.dataTransfer);
          if (!files.length) return false;
          event.preventDefault();
          void insertImageFiles(view, schema, files, imageDropTarget(view).pos);
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
    new Plugin({
      key: new PluginKey('imageDropLine'),
      view: (view) => new ImageDropLine(view),
    }),
    new Plugin({
      key: new PluginKey('imageView'),
      props: { nodeViews: { image: (node, view, getPos) => new ImageView(node, view, getPos) } },
    }),
  ],
});
