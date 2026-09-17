import { TextSelection } from 'prosemirror-state';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { createEditor, Editor } from '../../editor';
import { emailExtensions } from '../kits';

const schema = createSchema(emailExtensions);

describe('email paragraph indent', () => {
  it('reads a px margin-left in 40px steps, rounded and capped, and ignores other units', () => {
    const doc = parseHTML(
      '<div style="margin-left: 40px">one</div>' +
        '<div style="margin-left: 85px">two</div>' +
        '<div style="margin-left: 800px">deep</div>' +
        '<div style="margin-left: 2em">em</div>' +
        '<div>none</div>',
      schema,
    );
    expect([0, 1, 2, 3, 4].map((i) => doc.child(i).attrs['indent'])).toEqual([1, 2, 8, 0, 0]);
  });

  it('serializes the indent as inline margin-left beside the alignment, nothing at 0', () => {
    const doc = parseHTML(
      '<div style="text-align: center; margin-left: 80px">both</div><div style="margin-left: 0px">flat</div>',
      schema,
    );
    expect(serializeToHTML(doc, schema)).toBe(
      '<div style="text-align: center; margin-left: 80px;">both</div><div>flat</div>',
    );
  });

  it('keeps the indent on an empty-line marker', () => {
    const doc = parseHTML('<div style="margin-left: 40px"><br></div>', schema);
    expect(doc.child(0).childCount).toBe(0);
    expect(doc.child(0).attrs['indent']).toBe(1);
    expect(serializeToHTML(doc, schema)).toBe('<div style="margin-left: 40px;"><br></div>');
  });
});

describe('indent and outdent commands', () => {
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

  /** Puts the caret in the block at `index`, or selects from one block to another. */
  const select = (from: number, to = from) => {
    const { doc } = editor.state;
    let start = 0;
    let end = 0;
    doc.forEach((node, offset, i) => {
      if (i === from) start = offset + 1;
      if (i === to) end = offset + 1 + node.content.size;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(doc, start, from === to ? start : end)),
    );
  };

  it('moves the paragraphs the selection touches a step in and out, and stops at the margin', () => {
    editor.setContent('<div>one</div><div>two</div><div>three</div>');
    select(0, 1);
    expect(editor.commands['indent']()).toBe(true);
    expect(editor.getHTML()).toBe(
      '<div style="margin-left: 40px;">one</div><div style="margin-left: 40px;">two</div><div>three</div>',
    );
    select(0);
    expect(editor.commands['indent']()).toBe(true);
    expect(editor.getHTML()).toContain('<div style="margin-left: 80px;">one</div>');

    expect(editor.commands['outdent']()).toBe(true);
    expect(editor.commands['outdent']()).toBe(true);
    // Back on the margin: nothing more to give, so the key can fall through.
    expect(editor.commands['outdent']()).toBe(false);
    expect(editor.getHTML()).toBe(
      '<div>one</div><div style="margin-left: 40px;">two</div><div>three</div>',
    );
  });

  it('caps the indent', () => {
    editor.setContent('<div style="margin-left: 320px">deep</div>');
    select(0);
    expect(editor.commands['indent']()).toBe(false);
    expect(editor.getHTML()).toBe('<div style="margin-left: 320px;">deep</div>');
  });

  it('nests and lifts a list item instead of margining it', () => {
    editor.setContent('<ul><li><div>one</div></li><li><div>two</div></li></ul>');
    /** Puts the caret inside the word. */
    const caretIn = (word: string) => {
      const { doc } = editor.state;
      let at = -1;
      doc.descendants((node, pos) => {
        if (node.isText && node.text === word) at = pos;
      });
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, at + 1)));
    };
    // The caret is in the first item, which cannot nest under a sibling.
    caretIn('one');
    expect(editor.commands['indent']()).toBe(false);

    // In the second item: nest under the first…
    caretIn('two');
    expect(editor.commands['indent']()).toBe(true);
    expect(editor.getHTML()).toMatch(
      /<li><div>one<\/div><ul[^>]*><li><div>two<\/div><\/li><\/ul><\/li>/,
    );
    expect(editor.getHTML()).not.toContain('margin-left');

    // …and out again.
    expect(editor.commands['outdent']()).toBe(true);
    expect(editor.getHTML()).toMatch(/<li><div>one<\/div><\/li><li><div>two<\/div><\/li>/);
  });

  it('keeps the indent and alignment on the line Enter starts at the end of a line', () => {
    editor.setContent('<div style="text-align: center; margin-left: 40px">lead</div>');
    const { doc } = editor.state;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, 5)));
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(editor.getHTML()).toBe(
      '<div style="text-align: center; margin-left: 40px;">lead</div>' +
        '<div style="text-align: center; margin-left: 40px;"><br></div>',
    );
  });
});
