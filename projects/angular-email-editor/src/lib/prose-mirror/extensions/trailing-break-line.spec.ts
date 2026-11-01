import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { CARET_LINE_CLASS } from './trailing-break-line';

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
