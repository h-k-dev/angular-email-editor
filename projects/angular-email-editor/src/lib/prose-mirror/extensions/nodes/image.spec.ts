import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { emailExtensions } from '../kits';
import { createEditor } from '../../editor';
import {
  Image,
  ImageAttrs,
  PLACEHOLDER_WIDTH,
  claimedImageFiles,
  filledPlaceholderAttrs,
  imageDropTarget,
} from './image';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { Transform } from 'prosemirror-transform';
import { InlineImageStore, createInlineImages } from '../inline-images';
import { SendIntent, createSendIntent } from '../send-intent';

const schema = createSchema(emailExtensions);
const roundTrip = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

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
  });

  describe('selection: a node selection, painted on the editor-only wrapper', () => {
    const mount = () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const editor = createEditor({
        parent: host,
        extensions: emailExtensions,
        content: '<div>hello <img src="x.png" alt="dot"> world</div>',
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
      unmount();
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

    it('the line is the ceiling: an image never grows wider than the block it sits in', () => {
      const { wrapper, frame, down, move, up, width, unmount } = mount();
      Object.defineProperty(wrapper.parentElement, 'clientWidth', {
        value: 300,
        configurable: true,
      });
      down('right', 100);
      move(900);
      expect(frame.style.width).toBe('300px');
      up();
      expect(width()).toBe(300);
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
      const editor = createEditor({ parent: host, extensions: emailExtensions, content });
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
      const items = Image.slashItems!({ schema: editor.schema, extensions: [] });
      const item = items.find((candidate) => candidate.title === 'Image placeholder')!;
      expect(item.command(editor.state, editor.view.dispatch, editor.view)).toBe(true);
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
