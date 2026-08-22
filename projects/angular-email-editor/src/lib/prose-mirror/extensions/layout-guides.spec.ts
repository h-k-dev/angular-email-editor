import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { GUIDES_ACTIVE_CLASS } from './layout-guides';

describe('layout guides', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({
      parent: host,
      extensions: emailExtensions,
      content: '<div>intro</div>',
    });
    editor.exec((state, dispatch) => {
      dispatch?.(
        state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)),
      );
      return true;
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('marks the table the cursor is in', () => {
    editor.commands['insertTable']();
    // The class lands on the table's NodeView root (the `ColumnResize`
    // wrapper), which is the block's DOM as far as decorations go.
    const active = editor.view.dom.querySelector(`.${GUIDES_ACTIVE_CLASS}`);
    expect(active).not.toBeNull();
    expect(active!.querySelector('table')).not.toBeNull();
  });

  it('marks the columns block the cursor is in — the same class, one mechanism', () => {
    editor.commands['insertColumns'](2);
    // The class lands on the block's NodeView wrapper (the `ColumnsResize`
    // extension), which contains the `.aee-columns` container.
    const active = editor.view.dom.querySelector(`.${GUIDES_ACTIVE_CLASS}`);
    expect(active).not.toBeNull();
    expect(active!.querySelector('.aee-columns')).not.toBeNull();
  });

  it('marks nothing while the cursor is in ordinary text', () => {
    expect(editor.view.dom.querySelector(`.${GUIDES_ACTIVE_CLASS}`)).toBeNull();
  });

  it('renders the editor-only CSS hooks in the view', () => {
    editor.commands['insertColumns'](2);
    expect(editor.view.dom.querySelector('.aee-columns')).not.toBeNull();
    expect(editor.view.dom.querySelectorAll('.aee-column').length).toBe(2);
  });

  it('never leaks the editor-only hooks into the email', () => {
    editor.commands['insertColumns'](2);
    const html = editor.getHTML();
    // emitDOM drops the class: the email is bare inline-block divs.
    expect(html).not.toContain('aee-');
    expect(html).not.toContain('class=');
    expect(html).toContain('display: inline-block');
  });
});
