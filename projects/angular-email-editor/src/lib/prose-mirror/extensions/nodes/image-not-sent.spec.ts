import { Slice } from 'prosemirror-model';
import { createEditor } from '../../editor';
import { parseHTML } from '../../html';
import { emailExtensions } from '../kits';
import { SendIntent, createSendIntent } from '../send-intent';
import {
  IMAGE_NOT_SENT_CLASS,
  ImageFiles,
  createImageSources,
  embeddedImages,
  sendsEmbeddedImages,
  withoutEmbeddedImages,
} from './image';

const DATA = 'data:image/png;base64,iVBORw0KGgo=';
const LINKED = '<img src="https://example.com/a.png" alt="a" width="120">';
const EMBEDDED = `<img src="${DATA}" alt="b" width="80">`;

describe('withoutEmbeddedImages', () => {
  it('takes the source off every image that carries bytes, and nothing else', () => {
    const html = `<div>x ${LINKED} ${EMBEDDED} <img alt="c" src='cid:part@x'> <img src=blob:abc></div>`;
    expect(withoutEmbeddedImages(html)).toBe(
      `<div>x ${LINKED} <img alt="b" width="80"> <img alt="c"> <img></div>`,
    );
  });

  it('leaves HTML without one exactly as it is', () => {
    const html = `<div>data: is a word here ${LINKED} <a href="cid:x">part</a></div>`;
    expect(withoutEmbeddedImages(html)).toBe(html);
  });

  it('reads a tag past a > in its alt', () => {
    expect(withoutEmbeddedImages(`<img alt="a > b" src="${DATA}">`)).toBe('<img alt="a > b">');
  });
});

describe('embedded images while files are not embedded', () => {
  const mount = (files: () => ImageFiles, content: string) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const sent: SendIntent[] = [];
    const editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createImageSources({ files }),
        createSendIntent({ onSend: (intent) => sent.push(intent) }),
      ],
      content,
    });
    const send = () => (editor.commands['requestSend'](), sent.at(-1)!);
    const redraw = () => editor.view.dispatch(editor.state.tr);
    return { editor, host, send, redraw, unmount: () => (editor.destroy(), host.remove()) };
  };
  const BODY = `<div>hi ${LINKED} ${EMBEDDED}</div>`;

  it('still shows it, marked as not sent — and only it, only while off', () => {
    let mode: ImageFiles = 'placeholder';
    const { editor, host, redraw, unmount } = mount(() => mode, BODY);
    const marked = () => Array.from(host.querySelectorAll(`.${IMAGE_NOT_SENT_CLASS} img`));
    expect(sendsEmbeddedImages(editor.state)).toBe(false);
    expect(marked().map((img) => img.getAttribute('alt'))).toEqual(['b']);
    // The document keeps it: nothing was converted.
    expect(editor.getHTML()).toContain(DATA);

    mode = true;
    redraw();
    expect(marked()).toEqual([]);
    unmount();
  });

  it('sends its empty frame, and no inline part', () => {
    const { send, unmount } = mount(() => 'placeholder', BODY);
    const intent = send();
    expect(intent.html).not.toContain('data:');
    expect(intent.html).toContain('https://example.com/a.png');
    expect(intent.html).toContain('alt="b"');
    expect(intent.inlineImages).toEqual([]);
    unmount();
  });

  it("sends none of the quoted history's either", () => {
    const { editor, send, unmount } = mount(() => false, '<div>reply</div>');
    editor.setQuoted(`<div>quoted ${EMBEDDED}</div>`);
    const intent = send();
    expect(intent.html).toContain('quoted');
    expect(intent.html).not.toContain('data:');
    unmount();
  });

  it("'unsent' takes a pasted picture as it is: shown, tracked, kept back", () => {
    const { editor, host, send, unmount } = mount(() => 'unsent', '<div>x</div>');
    // What a paste hands the editor, through its paste rules (jsdom has no
    // clipboard to dispatch one with).
    let slice = new Slice(parseHTML(`<div>pic ${EMBEDDED}</div>`, editor.schema).content, 0, 0);
    editor.view.someProp('transformPasted', (transform) => {
      slice = transform(slice, editor.view, false);
    });
    editor.view.dispatch(editor.state.tr.replaceSelection(slice));
    expect(editor.getHTML()).toContain(DATA);
    expect(host.querySelectorAll(`.${IMAGE_NOT_SENT_CLASS}`).length).toBe(1);
    expect(embeddedImages(editor.state).length).toBe(1);
    expect(send().html).not.toContain('data:');
    unmount();
  });

  it('tracks them as the document changes: typed before, removed, put back', () => {
    const { editor, unmount } = mount(() => 'unsent', BODY);
    const at = () => embeddedImages(editor.state);
    const real = () => {
      const found: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'image' && /^data:/.test(node.attrs['src'] ?? '')) found.push(pos);
      });
      return found;
    };
    expect(at()).toEqual(real());
    expect(at().length).toBe(1);
    editor.view.dispatch(editor.state.tr.insertText('more words ', 1));
    expect(at()).toEqual(real());
    // Given a link: no longer embedded.
    const [pos] = at();
    const image = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, null, {
        ...image.attrs,
        src: 'https://example.com/b.png',
      }),
    );
    expect(at()).toEqual([]);
    editor.commands['undo']();
    expect(at()).toEqual(real());
    expect(at().length).toBe(1);
    // The whole document replaced.
    editor.setContent(`<div>${EMBEDDED}</div><div>${EMBEDDED}</div>`);
    expect(at()).toEqual(real());
    expect(at().length).toBe(2);
    editor.setContent('<div>none</div>');
    expect(at()).toEqual([]);
    unmount();
  });

  it('embedded, sends as it always did', () => {
    const { send, unmount } = mount(() => true, BODY);
    const intent = send();
    expect(intent.html.includes('data:') || intent.inlineImages.length > 0).toBe(true);
    unmount();
  });
});
