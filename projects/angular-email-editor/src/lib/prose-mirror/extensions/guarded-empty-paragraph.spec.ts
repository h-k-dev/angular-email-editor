import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';

/**
 * An empty `<p></p>` is kept as the source wrote it (no line in a mail
 * client — `trailing-break-line.ts`), so it is not the composer's own line.
 * A block command asked for in it makes it one first.
 */
describe('a block command in an empty <p> kept as written', () => {
  let host: HTMLElement;
  let editor: Editor;

  const SOURCE = '<p>a</p><p></p><p>b</p>';

  const action = (id: string) => editor.actions.find((a) => a.id === id)!;
  const run = (id: string) => editor.exec(action(id).command);
  const undo = () =>
    editor.exec((state, dispatch, view) => editor.commands['undo'](state, dispatch, view));
  const blocks = () => {
    const names: string[] = [];
    editor.state.doc.forEach((node) => names.push(node.type.name));
    return names;
  };

  /** `content`, the caret in its second block. */
  const mount = (content = SOURCE) => {
    editor?.destroy();
    editor = createEditor({ parent: host, extensions: emailExtensions, content });
    let at = 0;
    editor.state.doc.forEach((node, offset, index) => {
      if (index === 1) at = offset + 1;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    mount();
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('starts as the source wrote it, and stays so while nobody asks for a block', () => {
    expect(blocks()[1]).toBe('htmlTextElement');
    expect(editor.getHTML()).toBe(SOURCE);
    // Typing elsewhere changes nothing about it.
    editor.view.dispatch(editor.state.tr.insertText('x', 2));
    expect(blocks()[1]).toBe('htmlTextElement');
  });

  for (const [id, block] of [
    ['heading-1', 'heading'],
    ['heading-2-layout', 'heading'],
    ['bulleted-list', 'bulletList'],
    ['numbered-list', 'orderedList'],
    ['bulleted-list-layout', 'bulletList'],
    ['numbered-list-layout', 'orderedList'],
  ] as const) {
    it(`runs ${id}: the <p> becomes the block asked for`, () => {
      // A button asks first: it is offered, not dead.
      expect(action(id).command(editor.state)).toBe(true);
      expect(run(id)).toBe(true);
      expect(blocks()).toEqual(['paragraph', block, 'paragraph']);
      // The caret is in it: what is typed next is the block's.
      editor.view.dispatch(editor.state.tr.insertText('neu'));
      expect(editor.state.doc.child(1).textContent).toBe('neu');
    });

    it(`undoes ${id} in one step, back to the <p> as written`, () => {
      run(id);
      undo();
      expect(blocks()[1]).toBe('htmlTextElement');
      expect(editor.getHTML()).toBe(SOURCE);
    });
  }

  it('carries the paragraph’s alignment over to the line a list is made of', () => {
    mount('<p>a</p><p style="text-align: center;"></p><p>b</p>');
    expect(blocks()[1]).toBe('htmlTextElement');
    run('bulleted-list');
    const line = editor.state.doc.child(1).child(0).child(0);
    expect(line.type.name).toBe('paragraph');
    expect(line.attrs['align']).toBe('center');
  });

  it('leaves a <p> with words alone: that one is the composer’s line already', () => {
    mount('<p>a</p><p>mit Text</p><p>b</p>');
    expect(blocks()[1]).toBe('paragraph');
    run('heading-1');
    expect(blocks()[1]).toBe('heading');
  });

  // A heading takes any line of text as it is; a list needs the composer's
  // own line to wrap — which only an empty <p> is made into.
  it('leaves a list refused in any other kept element, as before', () => {
    mount('<p>a</p><center></center><p>b</p>');
    expect(blocks()[1]).toBe('htmlTextElement');
    expect(action('bulleted-list').command(editor.state)).toBe(false);
    expect(run('bulleted-list')).toBe(false);
    expect(blocks()[1]).toBe('htmlTextElement');
  });
});
