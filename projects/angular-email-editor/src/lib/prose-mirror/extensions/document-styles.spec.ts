import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { BODY_BOX_PREFIX, DOCUMENT_CLASS } from './document-styles';

describe('document styles', () => {
  let host: HTMLElement;
  let editor: Editor;

  const page = (body: string) =>
    `<!doctype html><html><head><meta charset="utf-8"></head><body ${body}><div>hi</div></body></html>`;

  const mount = (content: string) => {
    editor = createEditor({ parent: host, extensions: [...emailExtensions], content });
  };

  /** The root's inline style, as the browser holds it. */
  const root = () => editor.view.dom.style;
  const box = (name: string) => root().getPropertyValue(`${BODY_BOX_PREFIX}${name}`).trim();

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor?.destroy();
    host.remove();
  });

  it("puts the body's look on the root, its box out of the cascade's way", () => {
    mount(page('style="margin: 0; padding: 20px 0; background-color: #f2f2f2; color: #202124"'));
    expect(editor.view.dom.classList).toContain(DOCUMENT_CLASS);
    expect(root().backgroundColor).toBe('rgb(242, 242, 242)');
    expect(root().color).toBe('rgb(32, 33, 36)');
    // A template's `padding: 0` inline would beat every host rule for the
    // root's box — a page layout's gutter, the room under the last line.
    expect(root().padding).toBe('');
    expect(root().margin).toBe('');
    expect(box('margin')).toBe('0');
    expect(box('padding')).toBe('20px 0');
  });

  it('keeps each side of the box apart', () => {
    mount(page('style="padding-left: 8px; margin-top: 4px" bgcolor="#ffffff"'));
    expect(root().paddingLeft).toBe('');
    expect(box('padding-left')).toBe('8px');
    expect(box('margin-top')).toBe('4px');
    expect(root().backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('keeps a value with a semicolon in it whole', () => {
    mount(page(`style="background-image: url('data:image/png;base64,AAAA'); padding: 0"`));
    expect(root().backgroundImage).toContain('data:image/png;base64,AAAA');
    expect(box('padding')).toBe('0');
  });

  it('sets nothing on a plain message', () => {
    mount('<div>hi</div>');
    expect(editor.view.dom.classList).not.toContain(DOCUMENT_CLASS);
    expect(editor.view.dom.getAttribute('style') ?? '').not.toContain(BODY_BOX_PREFIX);
  });
});
