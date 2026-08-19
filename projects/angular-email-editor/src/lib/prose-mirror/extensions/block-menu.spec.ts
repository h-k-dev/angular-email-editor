import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { BlockMenuState, createBlockMenu } from './block-menu';

describe('block menu', () => {
  let host: HTMLElement;
  let editor: Editor;
  let state: BlockMenuState;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    state = { isOpen: false, boundingBox: null, block: null };
    editor = createEditor({
      parent: host,
      extensions: [
        ...emailExtensions,
        createBlockMenu({ onStateChange: (next) => (state = next) }),
      ],
      content: '<div>intro</div>',
    });
    editor.focus();
    editor.exec((s, dispatch) => {
      dispatch?.(s.tr.setSelection(TextSelection.create(s.doc, s.doc.content.size - 1)));
      return true;
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('stays closed in ordinary text', () => {
    expect(state.isOpen).toBe(false);
    expect(state.block).toBeNull();
  });

  it('opens on the table the cursor is in, anchored to the block', () => {
    editor.commands['insertTable']();
    expect(state.isOpen).toBe(true);
    expect(state.block).toBe('table');
    expect(state.boundingBox).not.toBeNull();
  });

  it('opens on the columns block the cursor is in', () => {
    editor.commands['insertColumns'](2);
    expect(state.isOpen).toBe(true);
    expect(state.block).toBe('columns');
  });

  it('closes for a text selection, so it never stacks with the bubble menu', () => {
    editor.commands['insertTable']();
    expect(state.isOpen).toBe(true);
    // Type into the cell, then select it: the bubble menu's territory.
    editor.exec((s, dispatch) => {
      dispatch?.(s.tr.insertText('ab'));
      return true;
    });
    editor.exec((s, dispatch) => {
      const { from } = s.selection;
      dispatch?.(s.tr.setSelection(TextSelection.create(s.doc, from - 2, from)));
      return true;
    });
    expect(state.isOpen).toBe(false);
  });

  it('reports closed once destroyed', () => {
    editor.commands['insertTable']();
    expect(state.isOpen).toBe(true);
    editor.destroy();
    expect(state.isOpen).toBe(false);
    // keep afterEach's destroy() harmless
    editor = createEditor({ parent: host, extensions: emailExtensions, content: '<div>x</div>' });
  });
});
