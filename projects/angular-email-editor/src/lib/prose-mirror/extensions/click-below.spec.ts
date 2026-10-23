import { Selection } from 'prosemirror-state';
import { splitBlock } from 'prosemirror-commands';
import { undo } from 'prosemirror-history';
import { createEditor, Editor } from '../editor';
import { emailExtensions } from './kits';
import { ClickBelow, clickBelow } from './click-below';

/** jsdom lays nothing out: every block's box ends at 0, so any click at a
    positive y is below the last block, and one at 0 is on it. */
const BELOW = 10;

describe('ClickBelow', () => {
  let host: HTMLElement;
  let editor: Editor;

  const mount = (content: string, extensions = emailExtensions) => {
    editor = createEditor({ parent: host, extensions, content });
  };
  const last = () => editor.state.doc.lastChild!;
  const caretInLast = () =>
    editor.state.selection.$from.parent === last() && editor.state.selection.empty;
  const toStart = () =>
    editor.view.dispatch(editor.state.tr.setSelection(Selection.atStart(editor.state.doc)));

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
  });

  afterEach(() => {
    // A case may mount none: the editor left over is an earlier case's, gone.
    if (editor && !editor.view.isDestroyed) editor.destroy();
    host.remove();
  });

  it('is in the kits', () => {
    expect(emailExtensions).toContain(ClickBelow);
  });

  it('starts a line under a heading, caret on it', () => {
    mount('<h1>Title</h1>');
    expect(clickBelow(editor.view, BELOW)).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    expect(last().type.name).toBe('paragraph');
    expect(last().content.size).toBe(0);
    expect(caretInLast()).toBe(true);
  });

  it('starts one under a table, where the gap cursor would park instead', () => {
    mount('<div>Above</div><table><tbody><tr><td>cell</td></tr></tbody></table>');
    expect(last().type.name).toBe('table');
    expect(clickBelow(editor.view, BELOW)).toBe(true);
    expect(last().type.name).toBe('paragraph');
    expect(caretInLast()).toBe(true);
  });

  it('takes the empty line already at the end, and leaves it be', () => {
    mount('<h1>Title</h1><div><br></div>');
    toStart();
    const before = editor.getHTML();
    expect(clickBelow(editor.view, BELOW)).toBe(true);
    expect(editor.state.doc.childCount).toBe(2);
    expect(caretInLast()).toBe(true);
    toStart();
    expect(editor.getHTML()).toBe(before);
  });

  it('takes the line back when it is left unused', () => {
    mount('<h1>Title</h1>');
    const before = editor.getHTML();
    clickBelow(editor.view, BELOW);
    toStart();
    expect(editor.getHTML()).toBe(before);
    expect(editor.state.doc.childCount).toBe(1);
  });

  it('keeps a line written in, and one Enter split', () => {
    mount('<h1>Title</h1>');
    clickBelow(editor.view, BELOW);
    editor.view.dispatch(editor.state.tr.insertText('Hello'));
    toStart();
    expect(last().textContent).toBe('Hello');
    editor.destroy();

    mount('<h1>Title</h1>');
    clickBelow(editor.view, BELOW);
    editor.exec(splitBlock);
    toStart();
    expect(editor.state.doc.childCount).toBe(3);
  });

  it('keeps the line on loan through an edit elsewhere — it only moves', () => {
    mount('<h1>Title</h1>');
    clickBelow(editor.view, BELOW);
    // A host's own edit above it, the caret still on the line.
    editor.view.dispatch(editor.state.tr.insertText('New ', 1));
    expect(caretInLast()).toBe(true);
    toStart();
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.textContent).toBe('New Title');
  });

  it('is no step of the undo history, coming or going', () => {
    mount('<h1>Title</h1>');
    const before = editor.getHTML();
    clickBelow(editor.view, BELOW);
    expect(undo(editor.state, editor.view.dispatch)).toBe(false);
    toStart();
    expect(editor.getHTML()).toBe(before);
    expect(undo(editor.state, editor.view.dispatch)).toBe(false);
  });

  it('is no click below for a press on the last block', () => {
    mount('<h1>Title</h1>');
    expect(clickBelow(editor.view, 0)).toBe(false);
    expect(editor.state.doc.childCount).toBe(1);
  });

  it('does nothing in a kit without it, nor in a read-only editor', () => {
    mount(
      '<h1>Title</h1>',
      emailExtensions.filter((extension) => extension !== ClickBelow),
    );
    expect(clickBelow(editor.view, BELOW)).toBe(false);
    editor.destroy();

    mount('<h1>Title</h1>');
    editor.view.setProps({ editable: () => false });
    expect(clickBelow(editor.view, BELOW)).toBe(false);
  });
});
