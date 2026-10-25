import { TextSelection } from 'prosemirror-state';
import { createEditor } from '../editor';
import { emailExtensions } from './kits';
import { ColumnHandleTarget, createColumnHandles } from './column-handles';

describe('createColumnHandles — the caret column’s grip', () => {
  const mount = (content = '<p>x</p>') => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const opened: (ColumnHandleTarget | null)[] = [];
    const editor = createEditor({
      parent: host,
      extensions: [...emailExtensions, createColumnHandles({ onOpen: (t) => opened.push(t) })],
      content,
    });
    return { editor, opened, unmount: () => (editor.destroy(), host.remove()) };
  };
  const grips = (root: HTMLElement) =>
    Array.from(root.querySelectorAll<HTMLElement>('.aee-grip--layout-column'));

  it('stands in the column the caret is in, one at a time, and opens the menu for it', () => {
    const { editor, opened, unmount } = mount();
    editor.commands['insertColumns'](2); // caret in the first column
    let [grip] = grips(editor.view.dom);
    expect(grips(editor.view.dom)).toHaveLength(1);
    expect(grip.closest('.aee-column')).toBe(editor.view.dom.querySelector('.aee-column'));
    expect(grip.getAttribute('aria-label')).toBe('Column 1 options');

    editor.commands['addColumn'](); // caret in the new, second column
    [grip] = grips(editor.view.dom);
    expect(grip.getAttribute('aria-label')).toBe('Column 2 options');

    grip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ kind: 'layout-column' });
    expect(editor.state.doc.nodeAt(opened[0]!.columnPos)?.type.name).toBe('column');
    expect(grip.getAttribute('aria-expanded')).toBe('true');
    unmount();
  });

  it('is gone outside the columns, and while the columns are static', () => {
    const { editor, opened, unmount } = mount();
    editor.commands['insertColumns'](2);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    expect(grips(editor.view.dom)).toHaveLength(0);

    editor.commands['insertColumns'](2);
    expect(grips(editor.view.dom)).toHaveLength(1);
    editor.commands['setLayoutInteraction']({ columns: false });
    expect(grips(editor.view.dom)).toHaveLength(0);
    // Switched off under it, the menu is told to go.
    expect(opened).toEqual([null]);
    unmount();
  });
});
