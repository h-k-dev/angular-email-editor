import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { CARET_BREAK_LINE_CLASS } from './trailing-break-line';

describe('trailing break line — the caret’s line when it ends in a line break', () => {
  let host: HTMLElement;
  let editor: Editor;

  const caretAt = (pos: number) =>
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  const marked = () => [...host.querySelectorAll(`.${CARET_BREAK_LINE_CLASS}`)];

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

  it('marks the line ending in a break while the caret is in it', () => {
    caretAt(3);
    expect(marked()).toHaveLength(1);
    expect(marked()[0].textContent).toContain('Looking for luxury');
  });

  it('marks nothing while the caret is on a line ending in words', () => {
    caretAt(editor.state.doc.content.size - 2);
    expect(marked()).toHaveLength(0);
  });

  it('never reaches the email', () => {
    caretAt(3);
    expect(editor.getHTML()).not.toContain(CARET_BREAK_LINE_CLASS);
    expect(editor.getHTML()).toBe('<div>Looking for luxury skin care?<br></div><div>plain</div>');
  });
});
