import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { CARET_LINE_CLASS, EMPTY_PARAGRAPH_CLASS } from './trailing-break-line';

describe('caret line — where ProseMirror’s caret aids stand', () => {
  let host: HTMLElement;
  let editor: Editor;

  const caretAt = (pos: number) =>
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  const marked = () => [...host.querySelectorAll(`.${CARET_LINE_CLASS}`)];

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>Looking for luxury skin care?<br></div><div>plain</div>',
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('marks the caret’s line — the one ending in a break', () => {
    caretAt(3);
    expect(marked()).toHaveLength(1);
    expect(marked()[0].textContent).toContain('Looking for luxury');
  });

  it('marks the caret’s line wherever it moves, and only that one', () => {
    caretAt(editor.state.doc.content.size - 2);
    expect(marked()).toHaveLength(1);
    expect(marked()[0].textContent).toBe('plain');
  });

  it('never reaches the email', () => {
    caretAt(3);
    expect(editor.getHTML()).not.toContain(CARET_LINE_CLASS);
    expect(editor.getHTML()).toBe('<div>Looking for luxury skin care?<br></div><div>plain</div>');
  });
});

describe('empty paragraph — no line where a client draws none', () => {
  let host: HTMLElement;
  let editor: Editor;

  const empty = () => [...host.querySelectorAll(`.${EMPTY_PARAGRAPH_CLASS}`)];
  const mount = (content: string) => {
    editor = createEditor({ parent: host, extensions: emailExtensions, content });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('marks an empty `<p>` kept as the source wrote it', () => {
    mount('<p>a</p><p style="text-align: justify;">\n</p><p>b</p>');
    expect(empty()).toHaveLength(1);
    expect(empty()[0].tagName).toBe('P');
    expect(empty()[0].textContent).toBe('');
  });

  it('marks neither a `<p><br></p>` nor the composer’s own empty line', () => {
    mount('<p>a</p><p><br></p><div><br></div><p>b</p>');
    expect(empty()).toEqual([]);
  });

  it('lets go of one that is written in', () => {
    mount('<p>a</p><p></p><p>b</p>');
    const pos = editor.state.doc.child(0).nodeSize + 1;
    editor.view.dispatch(editor.state.tr.insertText('x', pos));
    expect(empty()).toEqual([]);
  });

  it('never reaches the email', () => {
    mount('<p>a</p><p></p><p>b</p>');
    expect(editor.getHTML()).toBe('<p>a</p><p></p><p>b</p>');
  });
});
