import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { emailExtensions } from '../kits';
import { createEditor } from '../../editor';
import {
  CARET_ROOM,
  Image,
  ImageAttrs,
  PLACEHOLDER_WIDTH,
  ImageRefusal,
  ImageSourceOptions,
  ImageSourceRequest,
  claimedImageFiles,
  createImageDrag,
  createImageSources,
  imageSourceAccepted,
  filledPlaceholderAttrs,
  imageDropTarget,
  selectedImage,
  selectedImageAlt,
  openFileChooser,
} from './image';
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { extensionActions, isActionEnabled } from '../../extension';
import { BubbleMenuState, createBubbleMenu } from '../bubble-menu';
import { Transform } from 'prosemirror-transform';
import { InlineImageStore, createInlineImages } from '../inline-images';
import { SendIntent, createSendIntent } from '../send-intent';

const schema = createSchema(emailExtensions);
const roundTrip = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

describe('openFileChooser', () => {
  it('opens at once after a pointer, and anywhere but Windows', () => {
    const opened: string[] = [];
    openFileChooser(() => opened.push('pointer'), { keyboard: false, windows: true });
    openFileChooser(() => opened.push('mac'), { keyboard: true, windows: false });
    expect(opened).toEqual(['pointer', 'mac']);
  });

  it('from a key on Windows, waits for the pointer to move — or a moment — so the dialog shows a pointer', async () => {
    let opened = 0;
    openFileChooser(() => opened++, { keyboard: true, windows: true, wait: 200 });
    expect(opened).toBe(0);
    document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
    expect(opened).toBe(1);
    // Once: the move and the moment do not both open it.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(opened).toBe(1);

    let late = 0;
    openFileChooser(() => late++, { keyboard: true, windows: true, wait: 50 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(late).toBe(1);
  });
});

describe('image node', () => {
  // ProseMirror's own drop handler hit-tests the pointer; jsdom has no
  // elementFromPoint, so give it one that finds nothing.
  beforeAll(() => {
    document.elementFromPoint = () => null;
  });

  it('serializes hybrid sizing: width attribute for Outlook, fluid style for the rest', () => {
    expect(roundTrip('<img src="x.png" alt="chart" width="400">')).toBe(
      '<div><img src="x.png" alt="chart" width="400" style="width: 100%; max-width: 400px; height: auto;"></div>',
    );
  });

  it('falls back to fluid max-width when the width is unknown', () => {
    expect(roundTrip('<img src="x.png" alt="chart">')).toBe(
      '<div><img src="x.png" alt="chart" style="max-width: 100%; height: auto;"></div>',
    );
  });

  it('caps parsed widths at the email maximum', () => {
    expect(roundTrip('<img src="x.png" alt="wide" width="1200">')).toContain('width="600"');
  });

  it('reads width from styles and drops float on the floor', () => {
    expect(roundTrip('<img src="x.png" alt="a" style="float:left;width:300px">')).toBe(
      '<div><img src="x.png" alt="a" width="300" style="width: 100%; max-width: 300px; height: auto;"></div>',
    );
  });

  it('is inline — Gmail’s model: it lives in the text line, so the caret can stand beside it', () => {
    expect(schema.nodes['image'].isInline).toBe(true);
    const line =
      '<div>see <img src="x.png" alt="chart" style="max-width: 100%; height: auto;"> here</div>';
    expect(roundTrip(line)).toBe(line);
    // A bare image at the top level wraps into a line of its own, Gmail-style.
    expect(roundTrip('<div>a</div><img src="x.png" alt="b"><div>c</div>')).toBe(
      '<div>a</div><div><img src="x.png" alt="b" style="max-width: 100%; height: auto;"></div><div>c</div>',
    );
  });

  it('stays stable across repeated round trips', () => {
    const once = roundTrip('<img src="x.png" alt="chart" width="400">');
    expect(roundTrip(once)).toBe(once);
  });

  describe('drop claim rule: all images, or none', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const jpg = new File(['x'], 'b.jpg', { type: 'image/jpeg' });
    const pdf = new File(['x'], 'c.pdf', { type: 'application/pdf' });

    it('claims a pure image drop, whole', () => {
      expect(claimedImageFiles([png, jpg])).toEqual([png, jpg]);
    });

    it('claims nothing from a mixed drop — an attachment gesture, the host gets it entire', () => {
      expect(claimedImageFiles([png, pdf])).toEqual([]);
      expect(claimedImageFiles([pdf])).toEqual([]);
      expect(claimedImageFiles([])).toEqual([]);
    });

    it('leaves a mixed drop event untouched so it bubbles to the host dropzone', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const editor = createEditor({
        parent: host,
        extensions: emailExtensions,
        content: '<div>x</div>',
      });
      const drop = (files: File[]) => {
        const event = {
          dataTransfer: { files },
          preventDefault: vi.fn(),
          clientX: 0,
          clientY: 0,
        } as unknown as DragEvent;
        const claimed = editor.view.someProp('handleDrop', (f) =>
          f(editor.view, event, editor.state.doc.slice(0, 0), false),
        );
        return {
          claimed: claimed === true,
          prevented: (event.preventDefault as ReturnType<typeof vi.fn>).mock.calls.length,
        };
      };
      expect(drop([png, pdf])).toEqual({ claimed: false, prevented: 0 });
      expect(drop([png])).toEqual({ claimed: true, prevented: 1 });
      editor.destroy();
      host.remove();
    });

    it('claims an image drag as it comes over the text, and leaves any other file drag unclaimed', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      // How a drag is claimed is the host's — whatever its dropzone reads.
      const claims = new WeakSet<Event>();
      const isDragEventClaimed = (event: Event) => claims.has(event);
      const editor = createEditor({
        parent: host,
        extensions: [...emailExtensions, createImageDrag({ claim: (event) => claims.add(event) })],
        content: '<div>x</div>',
      });
      // A dropzone wrapping the editor stands down for a claimed drag: this
      // is what keeps its highlight off the text for the one drop it will
      // not get, and on for the PDF it will. ProseMirror's own acceptance of
      // the drag (preventDefault) is untouched either way.
      const drag = (type: string, items: { kind: string; type: string }[], types = ['Files']) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', {
          value: { items, types, getData: () => '' },
        });
        editor.view.dom.dispatchEvent(event);
        return { claimed: isDragEventClaimed(event), prevented: event.defaultPrevented };
      };
      const image = { kind: 'file', type: 'image/png' };
      const pdf = { kind: 'file', type: 'application/pdf' };
      const text = { kind: 'string', type: 'text/plain' };

      expect(drag('dragover', [image])).toEqual({ claimed: true, prevented: true });
      expect(drag('dragenter', [image])).toEqual({ claimed: true, prevented: true });
      expect(drag('dragover', [pdf])).toEqual({ claimed: false, prevented: true });
      expect(drag('dragover', [image, pdf])).toEqual({ claimed: false, prevented: true });
      expect(drag('dragover', [text], ['text/plain'])).toEqual({ claimed: false, prevented: true });

      editor.destroy();
      host.remove();
    });
  });

  describe('selection: a node selection, painted on the editor-only wrapper', () => {
    const mount = () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const editor = createEditor({
        parent: host,
        extensions: emailExtensions,
        content: '<div>hello <img src="x.png" alt="dot"> world</div>',
        // The image's canonical hybrid sizing is what these assert.
        parseMode: 'repair',
      });
      return { editor, unmount: () => (editor.destroy(), host.remove()) };
    };
    const imagePos = 7; // <div>(0) h e l l o ␣ → the atom sits at 7

    it('renders in a span.aee-image wrapper whose <img> is exactly toDOM; the wrapper never serializes', () => {
      const { editor, unmount } = mount();
      const wrapper = editor.view.nodeDOM(imagePos) as HTMLElement;
      expect(wrapper.tagName).toBe('SPAN');
      expect(wrapper.className).toBe('aee-image');
      const img = wrapper.querySelector('img')!;
      expect(img.getAttribute('src')).toBe('x.png');
      expect(img.getAttribute('style')).toBe('max-width: 100%; height: auto;');
      expect(editor.getHTML()).toBe(
        '<div>hello <img src="x.png" alt="dot" style="max-width: 100%; height: auto;"> world</div>',
      );
      unmount();
    });

    it('a node selection marks the wrapper — the tint and the outline hang on that class', () => {
      const { editor, unmount } = mount();
      expect(NodeSelection.isSelectable(editor.state.doc.nodeAt(imagePos)!)).toBe(true);
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
      );
      const wrapper = editor.view.nodeDOM(imagePos) as HTMLElement;
      expect(wrapper.classList.contains('ProseMirror-selectednode')).toBe(true);
      expect(wrapper.classList.contains('aee-atom--in-selection')).toBe(false);
      unmount();
    });

    it('a text range that covers the image tints it as a highlight, not a node selection', () => {
      const { editor, unmount } = mount();
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 14)),
      );
      const wrapper = editor.view.nodeDOM(imagePos) as HTMLElement;
      expect(wrapper.classList.contains('aee-atom--in-selection')).toBe(true);
      expect(wrapper.classList.contains('ProseMirror-selectednode')).toBe(false);
      unmount();
    });

    it('a drag that ends inside the image covers it, from either side', () => {
      const { editor, unmount } = mount();
      const { view } = editor;
      const wrapper = view.nodeDOM(imagePos) as HTMLElement;
      const [before, after] = [wrapper.previousSibling!, wrapper.nextSibling!];
      // What ProseMirror reads off the DOM selection, through the prop.
      const read = (anchor: [Node, number], head: [Node, number]) => {
        document.getSelection()!.setBaseAndExtent(...anchor, ...head);
        const $anchor = view.state.doc.resolve(view.posAtDOM(...anchor));
        const $head = view.state.doc.resolve(view.posAtDOM(...head));
        const selection = view.someProp('createSelectionBetween', (f) => f(view, $anchor, $head));
        return selection ? [selection.anchor, selection.head] : null;
      };
      // Forward from right beside it — ProseMirror alone reads this as empty.
      expect(read([before, 6], [wrapper, 0])).toEqual([imagePos, imagePos + 1]);
      expect(read([before, 2], [wrapper.querySelector('img')!, 0])).toEqual([3, imagePos + 1]);
      // Backward, and a drag that starts on it.
      expect(read([after, 0], [wrapper, 0])).toEqual([imagePos + 1, imagePos]);
      expect(read([wrapper, 0], [after, 3])).toEqual([imagePos, 11]);
      // Nothing to do when neither end is in an image.
      expect(read([before, 1], [after, 1])).toBeNull();
      unmount();
    });

    it('an image alone is the selected image — clicked, or dragged over with nothing beside it', () => {
      const { editor, unmount } = mount();
      const select = (selection: Selection) =>
        editor.view.dispatch(editor.state.tr.setSelection(selection));
      const { doc } = editor.state;

      select(NodeSelection.create(doc, imagePos));
      expect(selectedImage(editor.state)?.pos).toBe(imagePos);
      expect(selectedImageAlt(editor.state)).toBe('dot');
      select(TextSelection.create(doc, imagePos, imagePos + 1));
      expect(selectedImage(editor.state)?.pos).toBe(imagePos);
      // A letter on either side makes it a text selection; the spaces beside
      // it do not (see `soleInlineAtom`).
      select(TextSelection.create(doc, imagePos - 2, imagePos + 1));
      expect(selectedImage(editor.state)).toBeNull();
      select(TextSelection.create(doc, imagePos, imagePos + 3));
      expect(selectedImage(editor.state)).toBeNull();
      select(TextSelection.create(doc, imagePos - 1, imagePos + 2));
      expect(selectedImage(editor.state)?.pos).toBe(imagePos);
      select(TextSelection.create(doc, imagePos));
      expect(selectedImage(editor.state)).toBeNull();
      expect(selectedImageAlt(editor.state)).toBeNull();
      // An image without alt says so with '' — not null, which is "no image".
      const tr = editor.state.tr.setNodeMarkup(imagePos, undefined, { src: 'x.png', alt: null });
      editor.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, imagePos)));
      expect(selectedImageAlt(editor.state)).toBe('');
      unmount();
    });

    it('sets and clears the alt of the selected image, keeping it selected', () => {
      const { editor, unmount } = mount();
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
      );
      expect(editor.commands['setImageAlt']('  A red square ')).toBe(true);
      expect(editor.state.doc.nodeAt(imagePos)?.attrs['alt']).toBe('A red square');
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
      expect(editor.commands['setImageAlt']('')).toBe(true);
      expect(editor.state.doc.nodeAt(imagePos)?.attrs['alt']).toBeNull();
      // Nothing to do with the caret in the text.
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
      expect(editor.commands['setImageAlt']('x')).toBe(false);
      unmount();
    });

    it('removes the selected image — its actions are enabled only while it is the selection', () => {
      const { editor, unmount } = mount();
      const actions = extensionActions({
        schema: editor.state.schema,
        extensions: emailExtensions,
      });
      const enabled = (id: string) =>
        isActionEnabled(
          actions.find((action) => action.id === id)!,
          editor.state,
        );
      expect(enabled('remove-image')).toBe(false);
      expect(enabled('replace-image')).toBe(false);
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, imagePos, imagePos + 1),
        ),
      );
      expect(enabled('remove-image')).toBe(true);
      expect(enabled('replace-image')).toBe(true);
      expect(editor.commands['removeImage']()).toBe(true);
      expect(editor.getHTML()).toBe('<div>hello  world</div>');
      unmount();
    });

    it('the bubble menu opens for the image alone, over the picture, as an image menu', () => {
      vi.useFakeTimers();
      const host = document.createElement('div');
      document.body.appendChild(host);
      const states: BubbleMenuState[] = [];
      const editor = createEditor({
        parent: host,
        extensions: [
          ...emailExtensions,
          createBubbleMenu({ updateDelay: 0, onStateChange: (state) => states.push(state) }),
        ],
        content: '<div>hello <img src="x.png" alt="dot"> world</div>',
      });
      editor.view.hasFocus = () => true;
      const last = () => states[states.length - 1];

      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, imagePos)),
      );
      vi.runAllTimers();
      expect(last()).toMatchObject({ isOpen: true, kind: 'image' });
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, imagePos + 1)),
      );
      vi.runAllTimers();
      expect(last()).toMatchObject({ isOpen: true, kind: 'text' });

      vi.useRealTimers();
      editor.destroy();
      host.remove();
    });

    it('an attribute change updates the <img> in place — the wrapper survives', () => {
      const { editor, unmount } = mount();
      const wrapper = editor.view.nodeDOM(imagePos) as HTMLElement;
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(imagePos, undefined, {
          src: 'x.png',
          alt: 'dot',
          width: 300,
        }),
      );
      expect(editor.view.nodeDOM(imagePos)).toBe(wrapper);
      expect(wrapper.querySelector('img')?.getAttribute('width')).toBe('300');
      // The wrapper carries the cap, or an enlarged image would render at its
      // natural size in the editor while the email honours the cap.
      expect(wrapper.style.width).toBe('300px');
      unmount();
    });
  });

  describe('resize pads: a frame previews, the width lands on release', () => {
    const mount = () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const editor = createEditor({
        parent: host,
        extensions: emailExtensions,
        content: '<div>hello <img src="x.png" alt="dot"> world</div>',
        // The image's canonical hybrid sizing is what these assert.
        parseMode: 'repair',
      });
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 7)));
      const wrapper = editor.view.nodeDOM(7) as HTMLElement;
      // jsdom cannot measure: a 200×100 image.
      wrapper.querySelector('img')!.getBoundingClientRect = () =>
        ({
          width: 200,
          height: 100,
          top: 0,
          left: 0,
          right: 200,
          bottom: 100,
          x: 0,
          y: 0,
        }) as DOMRect;
      const pad = (side: string) => wrapper.querySelector(`.aee-image__pad--${side}`)!;
      const frame = wrapper.querySelector('.aee-image__frame') as HTMLElement;
      const down = (side: string, x: number) =>
        pad(side).dispatchEvent(
          new MouseEvent('pointerdown', { clientX: x, button: 0, bubbles: true }),
        );
      const move = (x: number) =>
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: x }));
      const up = () => window.dispatchEvent(new MouseEvent('pointerup'));
      const width = () => editor.state.doc.nodeAt(7)?.attrs['width'];
      return {
        editor,
        wrapper,
        frame,
        down,
        move,
        up,
        width,
        unmount: () => (editor.destroy(), host.remove()),
      };
    };

    it('shows both pads only on the selected image', () => {
      const { editor, wrapper, unmount } = mount();
      expect(wrapper.querySelectorAll('.aee-image__pad')).toHaveLength(2);
      expect(wrapper.classList.contains('ProseMirror-selectednode')).toBe(true);
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
      expect(wrapper.classList.contains('ProseMirror-selectednode')).toBe(false);
      unmount();
    });

    it('the right pad previews a frame at the new size with the ratio, commits on release, keeps the selection', () => {
      const { editor, wrapper, frame, down, move, up, width, unmount } = mount();
      down('right', 100);
      expect(wrapper.classList.contains('aee-image--resizing')).toBe(true);
      expect(wrapper.classList.contains('aee-image--resizing-right')).toBe(true);
      move(150);
      expect(frame.style.width).toBe('250px');
      expect(frame.style.height).toBe('125px');
      expect(width()).toBeNull(); // nothing committed while dragging
      move(900);
      expect(frame.style.width).toBe('600px'); // capped at MAX_IMAGE_WIDTH
      move(150);
      up();
      expect(wrapper.classList.contains('aee-image--resizing')).toBe(false);
      expect(frame.getAttribute('style')).toBeNull();
      expect(width()).toBe(250);
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
      expect(editor.getHTML()).toContain(
        'width="250" style="width: 100%; max-width: 250px; height: auto;"',
      );
      unmount();
    });

    it('the left pad grows leftwards and floors at the minimum', () => {
      const { frame, down, move, up, width, unmount } = mount();
      down('left', 100);
      move(60);
      expect(frame.style.width).toBe('240px');
      move(1000);
      expect(frame.style.width).toBe('40px');
      up();
      expect(width()).toBe(40);
      unmount();
    });

    it('the line less the caret’s room is the ceiling: an image never fills the block it sits in', () => {
      const { wrapper, frame, down, move, up, width, unmount } = mount();
      Object.defineProperty(wrapper.parentElement, 'clientWidth', {
        value: 300,
        configurable: true,
      });
      down('right', 100);
      move(900);
      expect(frame.style.width).toBe(`${300 - CARET_ROOM}px`);
      up();
      expect(width()).toBe(300 - CARET_ROOM);
      unmount();
    });

    it('a press-and-release without movement commits nothing', () => {
      const { editor, down, up, width, unmount } = mount();
      const before = editor.state.doc;
      down('right', 100);
      up();
      expect(width()).toBeNull();
      expect(editor.state.doc).toBe(before);
      unmount();
    });
  });

  describe('placeholder: an image without a source — size the frame, click to fill it', () => {
    const mount = (content: string) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      // The frame's canonical sizing is what these assert.
      const editor = createEditor({
        parent: host,
        extensions: emailExtensions,
        content,
        parseMode: 'repair',
      });
      return { editor, unmount: () => (editor.destroy(), host.remove()) };
    };

    it('round-trips as an <img> without src, keeping its frame; an empty src is the same thing', () => {
      expect(roundTrip('<img width="320">')).toBe(
        '<div><img width="320" style="width: 100%; max-width: 320px; height: auto;"></div>',
      );
      expect(roundTrip('<img src="" alt="hero" width="320">')).toBe(
        '<div><img alt="hero" width="320" style="width: 100%; max-width: 320px; height: auto;"></div>',
      );
    });

    it('the slash item inserts a placeholder at the phone width, inline at the caret', () => {
      const { editor, unmount } = mount('<div>before</div>');
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 7)));
      const items = Image.actions!({ schema: editor.schema, extensions: [] });
      const item = items.find((candidate) => candidate.title === 'Image placeholder')!;
      expect(item.command!(editor.state, editor.view.dispatch, editor.view)).toBe(true);
      expect(editor.getHTML()).toBe(
        `<div>before<img width="${PLACEHOLDER_WIDTH}" style="width: 100%; max-width: ${PLACEHOLDER_WIDTH}px; height: auto;"></div>`,
      );
      unmount();
    });

    it('renders as a dashed frame with the resize pads, and becomes the image once filled', () => {
      const { editor, unmount } = mount('<div><img width="320"></div>');
      const wrapper = editor.view.nodeDOM(1) as HTMLElement;
      expect(wrapper.classList.contains('aee-image--placeholder')).toBe(true);
      expect(wrapper.querySelector('.aee-image__placeholder')).not.toBeNull();
      expect(wrapper.querySelector('img')).toBeNull();
      expect(wrapper.querySelectorAll('.aee-image__pad')).toHaveLength(2);
      expect(wrapper.style.width).toBe('320px');

      const filled = filledPlaceholderAttrs(editor.state.doc.nodeAt(1)!.attrs as ImageAttrs, {
        src: 'x.png',
        alt: 'picked',
        width: 1200,
      });
      editor.view.dispatch(editor.state.tr.setNodeMarkup(1, undefined, filled));
      expect(wrapper.classList.contains('aee-image--placeholder')).toBe(false);
      expect(wrapper.querySelector('.aee-image__placeholder')).toBeNull();
      expect(wrapper.querySelector('img')?.getAttribute('src')).toBe('x.png');
      expect(editor.getHTML()).toBe(
        '<div><img src="x.png" alt="picked" width="320" style="width: 100%; max-width: 320px; height: auto;"></div>',
      );
      unmount();
    });

    it('a token source is the same placeholder: its expression dead centre, a click opens the picker, the token kept in the HTML', () => {
      const { editor, unmount } = mount(
        '<div style="text-align: center;"><img src="{{ company.logoUrl }}" alt="{{ company.name }}" width="48"></div>',
      );
      const wrapper = editor.view.dom.querySelector('.aee-image') as HTMLElement;
      expect(wrapper.classList.contains('aee-image--placeholder')).toBe(true);
      const frame = wrapper.querySelector('.aee-image__placeholder--pending')!;
      expect(frame.querySelector('.aee-image__token')?.textContent).toBe('{{ company.logoUrl }}');
      expect(wrapper.querySelector('img')).toBeNull();
      expect(editor.getHTML()).toContain('src="{{ company.logoUrl }}"');

      const chooser = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
      frame.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(chooser).toHaveBeenCalledTimes(1);
      chooser.mockRestore();
      document.body.querySelectorAll('input[type="file"]').forEach((input) => input.remove());
      unmount();
    });

    it('a source merely holding braces outside a token is drawn as the image', () => {
      const { editor, unmount } = mount('<div><img src="x.png?q={a}" width="48"></div>');
      const wrapper = editor.view.dom.querySelector('.aee-image') as HTMLElement;
      expect(wrapper.classList.contains('aee-image--placeholder')).toBe(false);
      expect(wrapper.querySelector('img')).not.toBeNull();
      unmount();
    });

    it('filling keeps the frame the author sized and their alt, taking the file for the rest', () => {
      const placeholder: ImageAttrs = { src: null, alt: 'hero', width: 320 };
      expect(filledPlaceholderAttrs(placeholder, { src: 'a.png', alt: 'a', width: 600 })).toEqual({
        src: 'a.png',
        alt: 'hero',
        width: 320,
      });
      expect(
        filledPlaceholderAttrs({ src: null, width: null }, { src: 'a.png', alt: 'a', width: 600 }),
      ).toEqual({
        src: 'a.png',
        alt: 'a',
        width: 600,
      });
    });
  });

  describe('cid: sources resolve through the registry — a view concern, never the document', () => {
    const mount = (content: string, store: InlineImageStore) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const editor = createEditor({
        parent: host,
        extensions: [...emailExtensions, createInlineImages({ registry: store })],
        content,
      });
      return { editor, unmount: () => (editor.destroy(), host.remove()) };
    };
    const store = () =>
      new InlineImageStore({ createUrl: (b) => `blob:fake/${b.size}`, revokeUrl: () => {} });

    it('displays a known part through its URL while the document keeps the cid', () => {
      const registry = store();
      registry.add(new Blob(['abc']), 'p1');
      const { editor, unmount } = mount('<div><img src="cid:p1" alt="logo"></div>', registry);
      const wrapper = editor.view.nodeDOM(1) as HTMLElement;
      expect(wrapper.querySelector('img')?.getAttribute('src')).toBe('blob:fake/3');
      expect(editor.getHTML()).toContain('src="cid:p1"');
      unmount();
    });

    it('renders a missing frame for an unknown part, and re-resolves when the part arrives', () => {
      const registry = store();
      const { editor, unmount } = mount('<div><img src="cid:late" alt="logo"></div>', registry);
      const wrapper = editor.view.nodeDOM(1) as HTMLElement;
      expect(wrapper.querySelector('.aee-image__missing')).not.toBeNull();
      expect(wrapper.querySelector('img')).toBeNull();
      registry.add(new Blob(['abcd']), 'late');
      expect(wrapper.querySelector('.aee-image__missing')).toBeNull();
      expect(wrapper.querySelector('img')?.getAttribute('src')).toBe('blob:fake/4');
      expect(editor.getHTML()).toContain('src="cid:late"');
      unmount();
    });

    it('the send intent reads the bytes from the registry', () => {
      const registry = store();
      const bytes = new Blob(['xy'], { type: 'image/png' });
      registry.add(bytes, 'p1');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const sent: SendIntent[] = [];
      const editor = createEditor({
        parent: host,
        extensions: [
          ...emailExtensions,
          createInlineImages({ registry }),
          createSendIntent({ onSend: (intent) => sent.push(intent) }),
        ],
        content: '<div><img src="cid:p1" alt="logo"></div>',
      });
      editor.commands['requestSend']();
      expect(sent[0].inlineImages).toEqual([{ cid: 'p1', blob: bytes }]);
      expect(sent[0].html).toContain('src="cid:p1"');
      editor.destroy();
      host.remove();
    });
  });

  describe('drop line: under the visual line the image is about to join', () => {
    it('inserted at a block boundary, the inline image takes a line of its own', () => {
      // <div>one</div> spans 0..5, <div>two</div> 5..10.
      const doc = parseHTML('<div>one</div><div>two</div>', schema);
      const node = schema.nodes['image'].create({ src: 'x.png', alt: 'a' });
      const tr = new Transform(doc).insert(5, node);
      expect(serializeToHTML(tr.doc, schema)).toBe(
        '<div>one</div><div><img src="x.png" alt="a" style="max-width: 100%; height: auto;"></div><div>two</div>',
      );
      // The next image goes after the new line, not inside it.
      expect(tr.mapping.map(5)).toBe(5 + node.nodeSize + 2);
    });

    it('tells the host, through createImageDrag, when an image drag is over the text — on change only', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const reported: boolean[] = [];
      const editor = createEditor({
        parent: host,
        extensions: [
          ...emailExtensions,
          createImageDrag({ onChange: (over) => reported.push(over) }),
        ],
        content: '<div>one</div>',
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
      editor.view.coordsAtPos = () => ({ top: 0, bottom: 20, left: 0, right: 0 });
      const drag = (type: string, items: { kind: string; type: string }[]) => {
        const event = new Event(type, { bubbles: true });
        Object.defineProperty(event, 'dataTransfer', {
          value: { items, types: ['Files'], getData: () => '' },
        });
        editor.view.dom.dispatchEvent(event);
      };
      const image = { kind: 'file', type: 'image/png' };
      const pdf = { kind: 'file', type: 'application/pdf' };

      drag('dragover', [image]);
      drag('dragover', [image]);
      expect(reported).toEqual([true]);
      // A mixed drag is the host's, and says so.
      drag('dragover', [image, pdf]);
      expect(reported).toEqual([true, false]);
      drag('dragover', [image]);
      drag('drop', [image]);
      expect(reported).toEqual([true, false, true, false]);

      editor.destroy();
      host.remove();
    });

    it('draws the line for an image drag, removes it on drop, and draws nothing for a mixed drag', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const editor = createEditor({
        parent: host,
        extensions: emailExtensions,
        content: '<div>one</div><div>two</div>',
      });
      // The caret sits in line one; jsdom cannot measure, so answer the caret
      // geometry ourselves. The pointer never matters: Gmail's rule.
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
      editor.view.coordsAtPos = () => ({ top: 0, bottom: 20, left: 0, right: 0 });
      expect(imageDropTarget(editor.view).pos).toBe(2);
      const drag = (type: string, items: { kind: string; type: string }[]) => {
        const event = new Event(type, { bubbles: true });
        Object.defineProperty(event, 'dataTransfer', {
          value: { items, types: ['Files'], getData: () => '' },
        });
        editor.view.dom.dispatchEvent(event);
        return document.querySelector('.aee-drop-line') as HTMLElement | null;
      };
      const image = { kind: 'file', type: 'image/png' };
      const pdf = { kind: 'file', type: 'application/pdf' };

      const line = drag('dragover', [image]);
      expect(line).not.toBeNull();
      expect(line?.style.top).toBe('20px');
      expect(drag('drop', [image])).toBeNull();
      expect(drag('dragover', [image, pdf])).toBeNull();
      expect(drag('dragover', [image])).not.toBeNull();
      expect(drag('dragend', [image])).toBeNull();

      editor.destroy();
      host.remove();
    });
  });

  it('refuses script URLs on parse — same rule as the link mark', () => {
    // The node dies; what remains is the canonical empty document.
    expect(roundTrip('<img src="javascript:evil()" alt="x">')).toBe('<div><br></div>');
    expect(roundTrip('<img src=" JavaScript:evil()">')).toBe('<div><br></div>');
    // Legitimate schemes still parse.
    expect(roundTrip('<img src="data:image/png;base64,AAAA" alt="ok">')).toContain(
      'data:image/png',
    );
  });
});

describe('image sources: the host’s rules', () => {
  const https = (src: string) => /^https:\/\//i.test(src);
  const png = new File(['x'], 'a.png', { type: 'image/png' });

  /** jsdom never loads a picture: measuring one fails at once (no width)
      instead of waiting for a load that never comes. */
  const measureNothing = () =>
    vi
      .spyOn(HTMLImageElement.prototype, 'src', 'set')
      .mockImplementation(function (this: HTMLImageElement) {
        queueMicrotask(() => this.onerror?.(new Event('error')));
      });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  const mount = (options: ImageSourceOptions, content = '<div>x</div>') => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const extensions = [...emailExtensions, createImageSources(options)];
    const editor = createEditor({ parent: host, extensions, content, parseMode: 'repair' });
    const enabled = (id: string) =>
      isActionEnabled(
        extensionActions({ schema: editor.schema, extensions }).find((action) => action.id === id)!,
        editor.state,
      );
    return { editor, enabled, unmount: () => (editor.destroy(), host.remove()) };
  };

  it('bytes go by files, addresses by accept; placeholders and tokens always pass', () => {
    const linked: ImageSourceOptions = { files: false, accept: https };
    expect(imageSourceAccepted({}, 'data:image/png;base64,AAAA')).toBe(true);
    expect(imageSourceAccepted({}, 'http://example.com/a.png')).toBe(true);
    expect(imageSourceAccepted(linked, 'https://example.com/a.png')).toBe(true);
    expect(imageSourceAccepted(linked, 'http://example.com/a.png')).toBe(false);
    for (const bytes of ['data:image/png;base64,AAAA', 'blob:x', 'file:///a.png', 'cid:part'])
      expect(imageSourceAccepted(linked, bytes)).toBe(false);
    expect(imageSourceAccepted({ accept: https }, 'data:image/png;base64,AAAA')).toBe(true);
    expect(imageSourceAccepted(linked, null)).toBe(true);
    expect(imageSourceAccepted(linked, '{{ company.logoUrl }}')).toBe(true);
    expect(imageSourceAccepted({}, 'javascript:alert(1)')).toBe(false);
  });

  it('a paste keeps only the images the rules take, and says which it dropped', async () => {
    const refused: ImageRefusal[] = [];
    const { editor, unmount } = mount({
      files: false,
      accept: https,
      onRefused: (refusal) => refused.push(refusal),
    });
    const html =
      '<div>a<img src="https://example.com/a.png">b<img src="data:image/png;base64,AAAA">' +
      'c<img src="http://example.com/c.png"><img src="{{ logo }}"></div>';
    const event = Object.assign(new Event('paste'), {
      clipboardData: { getData: (type: string) => (type === 'text/html' ? html : ''), types: ['text/html'] },
    }) as unknown as ClipboardEvent;
    editor.view.pasteHTML(html, event);
    const out = editor.getHTML();
    expect(out).toContain('src="https://example.com/a.png"');
    expect(out).toContain('src="{{ logo }}"');
    expect(out).not.toContain('data:image');
    expect(out).not.toContain('http://example.com/c.png');
    // Told once the paste is done, each address once.
    expect(refused).toEqual([]);
    await settle();
    expect(refused).toEqual([
      { reason: 'source', src: 'data:image/png;base64,AAAA' },
      { reason: 'source', src: 'http://example.com/c.png' },
    ]);
    unmount();
  });

  describe('drops', () => {
    const drop = (
      editor: ReturnType<typeof mount>['editor'],
      files: File[],
      data: Record<string, string> = {},
    ) => {
      const event = {
        dataTransfer: { files, types: ['Files', ...Object.keys(data)], getData: (type: string) => data[type] ?? '' },
        preventDefault: vi.fn(),
        clientX: 0,
        clientY: 0,
      } as unknown as DragEvent;
      const claimed = editor.view.someProp('handleDrop', (f) =>
        f(editor.view, event, editor.state.doc.slice(0, 0), false),
      );
      return {
        claimed: claimed === true,
        prevented: (event.preventDefault as ReturnType<typeof vi.fn>).mock.calls.length,
      };
    };

    it('without files, a drop from the desktop is turned away and left to bubble', () => {
      const refused: ImageRefusal[] = [];
      const { editor, unmount } = mount({ files: false, onRefused: (r) => refused.push(r) });
      expect(drop(editor, [png])).toEqual({ claimed: false, prevented: 0 });
      expect(refused).toEqual([{ reason: 'file', files: [png] }]);
      expect(editor.getHTML()).toBe('<div>x</div>');
      unmount();
    });

    it('without files, a picture dragged from a web page comes in by its address', async () => {
      const measured = measureNothing();
      const refused: ImageRefusal[] = [];
      const { editor, unmount } = mount({
        files: false,
        accept: https,
        onRefused: (r) => refused.push(r),
      });
      const web = { 'text/html': '<meta charset="utf-8"><img src="https://example.com/cat.png" alt="cat">' };
      expect(drop(editor, [png], web)).toEqual({ claimed: true, prevented: 1 });
      await settle();
      expect(editor.getHTML()).toContain('src="https://example.com/cat.png"');
      expect(refused).toEqual([]);
      measured.mockRestore();
      unmount();
    });

    it('without files, a web picture the rules turn away is not taken by its address', () => {
      const { editor, unmount } = mount({ files: false, accept: https });
      const web = { 'text/uri-list': 'http://example.com/cat.png' };
      expect(drop(editor, [png], web)).toEqual({ claimed: false, prevented: 0 });
      unmount();
    });

    it('with files (the default), an image drop is embedded as ever', () => {
      const { editor, unmount } = mount({});
      expect(drop(editor, [png])).toEqual({ claimed: true, prevented: 1 });
      unmount();
    });
  });

  it('a paste of image files alone is turned away; one with HTML beside it pastes the HTML', () => {
    const refused: ImageRefusal[] = [];
    const { editor, unmount } = mount({ files: false, onRefused: (r) => refused.push(r) });
    const paste = (types: string[]) => {
      const event = { clipboardData: { files: [png], types, getData: () => '' } } as unknown as ClipboardEvent;
      return editor.view.someProp('handlePaste', (f) => f(editor.view, event, editor.state.doc.slice(0, 0)));
    };
    expect(paste(['Files'])).toBeFalsy();
    expect(refused).toEqual([{ reason: 'file', files: [png] }]);
    expect(paste(['Files', 'text/html'])).toBeFalsy();
    expect(refused).toHaveLength(1);
    unmount();
  });

  it('without files or a way to choose, /image and Replace image are off; choose turns them on', () => {
    const off = mount({ files: false }, '<div>a<img src="https://example.com/a.png">b</div>');
    off.editor.view.dispatch(off.editor.state.tr.setSelection(NodeSelection.create(off.editor.state.doc, 2)));
    expect(off.enabled('image')).toBe(false);
    expect(off.enabled('replace-image')).toBe(false);
    expect(off.enabled('remove-image')).toBe(true);
    off.unmount();

    const on = mount({ files: false, choose: async () => null }, '<div>a<img src="https://example.com/a.png">b</div>');
    on.editor.view.dispatch(on.editor.state.tr.setSelection(NodeSelection.create(on.editor.state.doc, 2)));
    expect(on.enabled('image')).toBe(true);
    expect(on.enabled('replace-image')).toBe(true);
    on.unmount();
  });

  it('choose stands in for the file picker: insert, fill a placeholder, replace — through the rules', async () => {
    const measured = measureNothing();
    const picker = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const requests: ImageSourceRequest[] = [];
    const answers = ['https://example.com/new.png', 'https://example.com/filled.png', 'http://example.com/no.png'];
    const refused: ImageRefusal[] = [];
    const { editor, unmount } = mount(
      {
        files: false,
        accept: https,
        choose: async (request) => {
          requests.push(request);
          return { src: answers.shift()!, alt: 'chosen' };
        },
        onRefused: (r) => refused.push(r),
      },
      '<div>a<img alt="frame" width="320">b</div>',
    );

    // `/image`: at the caret.
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    const actions = extensionActions({ schema: editor.schema, extensions: emailExtensions });
    actions.find((action) => action.id === 'image')!.command!(editor.state, editor.view.dispatch, editor.view);
    await settle();
    expect(editor.getHTML()).toContain('src="https://example.com/new.png"');

    // A click on the placeholder fills it, keeping its frame and its alt.
    const frame = editor.view.dom.querySelector('.aee-image__placeholder') as HTMLElement;
    frame.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();
    expect(editor.getHTML()).toContain('src="https://example.com/filled.png" alt="frame" width="320"');

    // Replace: an address the rules turn away changes nothing, and is told.
    const before = editor.getHTML();
    let filledPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.attrs['src'] === 'https://example.com/filled.png') filledPos = pos;
    });
    editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, filledPos)));
    actions.find((action) => action.id === 'replace-image')!.command!(editor.state, editor.view.dispatch, editor.view);
    await settle();
    expect(editor.getHTML()).toBe(before);

    expect(requests.map((request) => request.kind)).toEqual(['insert', 'fill', 'replace']);
    expect(requests[1].current).toMatchObject({ alt: 'frame', width: 320 });
    expect(refused).toEqual([{ reason: 'source', src: 'http://example.com/no.png' }]);
    expect(picker).not.toHaveBeenCalled();
    picker.mockRestore();
    measured.mockRestore();
    unmount();
  });

  it('insertImage takes only what the rules take', () => {
    const { editor, unmount } = mount({ files: false, accept: https });
    expect(editor.commands['insertImage']({ src: 'http://example.com/a.png' })).toBe(false);
    expect(editor.commands['insertImage']({ src: 'data:image/png;base64,AAAA' })).toBe(false);
    expect(editor.commands['insertImage']({ src: 'https://example.com/a.png' })).toBe(true);
    unmount();
  });
});
