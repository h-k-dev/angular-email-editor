import { TextSelection } from 'prosemirror-state';
import { Editor, createEditor } from '../../editor';
import { emailExtensions } from '../kits';
import { linkRangeAt } from './link';

const linkOpen = (href: string) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">`;

describe('link editing', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      // "visit site now" — the link covers "site" (positions 7..11).
      content: '<div>visit <a href="https://old.io">site</a> now</div>',
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  const cursorAt = (pos: number) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, pos)));
      return true;
    });

  it('linkRangeAt finds the full extent from inside the link', () => {
    expect(linkRangeAt(editor.state, 9)).toMatchObject({
      from: 7,
      to: 11,
      attrs: { href: 'https://old.io' },
    });
    expect(linkRangeAt(editor.state, 3)).toBeNull();
  });

  it('setLink from a bare cursor rewrites the whole link', () => {
    cursorAt(9);
    expect(editor.commands['setLink']({ href: 'https://new.io' })).toBe(true);
    expect(editor.getHTML()).toBe(`<div>visit ${linkOpen('https://new.io')}site</a> now</div>`);
  });

  it('unsetLink from a bare cursor removes the whole link', () => {
    cursorAt(9);
    expect(editor.commands['unsetLink']()).toBe(true);
    expect(editor.getHTML()).toBe('<div>visit site now</div>');
  });

  it('setLink refuses script URLs, selection or not', () => {
    cursorAt(9);
    expect(editor.commands['setLink']({ href: 'javascript:alert(1)' })).toBe(false);
  });
});

describe('auto-link input rule', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: emailExtensions });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  /** Simulates the committing space keystroke at the end of the text. */
  function typeSpaceAfter(content: string): boolean {
    editor.setContent(content);
    const end = editor.state.doc.firstChild!.nodeSize - 1;
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, end)));
      return true;
    });
    return !!editor.view.someProp('handleTextInput', (f) =>
      f(editor.view, end, end, ' ', () => editor.state.tr.insertText(' ', end, end)),
    );
  }

  it('links a typed URL as the space commits it', () => {
    expect(typeSpaceAfter('<div>go https://x.io</div>')).toBe(true);
    expect(editor.getHTML()).toBe(`<div>go ${linkOpen('https://x.io')}https://x.io</a> </div>`);
  });

  it('prepends https:// to www URLs and keeps punctuation outside', () => {
    expect(typeSpaceAfter('<div>at www.x.io,</div>')).toBe(true);
    expect(editor.getHTML()).toBe(`<div>at ${linkOpen('https://www.x.io')}www.x.io</a>, </div>`);
  });

  it('leaves plain prose alone', () => {
    expect(typeSpaceAfter('<div>just words</div>')).toBe(false);
  });
});
