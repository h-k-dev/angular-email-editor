import { Node } from 'prosemirror-model';
import { AllSelection, NodeSelection, TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../editor';
import { insertHTML, replaceHTML } from '../html';
import { emailExtensions } from './kits';
import { BlockSelection } from './block-selection';

const SECTION =
  '<table class="aee-layout-section" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;"><tbody><tr><td bgcolor="#f1f3f4" style="padding: 20px 0px; background-color: rgb(241, 243, 244); color: rgb(32, 33, 36);"><div style="max-width: 600px; margin-left: auto; margin-right: auto; padding-left: 16px; padding-right: 16px; box-sizing: border-box;"><div>band</div></div></td></tr></tbody></table>';
const COLUMN =
  'display: inline-block; width: 100%; max-width: 280px; vertical-align: top; box-sizing: border-box;';
const COLUMNS = `<div class="aee-layout-columns" style="width: 100%; max-width: 600px;"><div class="aee-layout-column" style="${COLUMN}"><div>left</div></div><div class="aee-layout-column" style="${COLUMN}"><div>right</div></div></div>`;
const CELL = 'vertical-align: top; overflow-wrap: break-word;';
const LAYOUT_TABLE = `<table class="aee-layout-table" role="presentation" style="width: 100%; table-layout: fixed; border-collapse: collapse;"><tbody><tr><td style="${CELL}">one</td><td style="${CELL}">two</td></tr></tbody></table>`;
const LINED = `padding: 7px 9px; ${CELL} border: 1px solid rgb(230, 229, 227);`;
const CONTENT_TABLE = `<table style="width: 100%; margin-top: 16px; margin-bottom: 16px; table-layout: fixed; border-collapse: collapse;"><tbody><tr><td style="${LINED}">a</td><td style="${LINED}">b</td></tr></tbody></table>`;
const SPACER =
  '<div class="aee-layout-spacer" style="height: 24px; line-height: 24px; font-size: 1px; mso-line-height-rule: exactly;">&nbsp;</div>';

const PAGE =
  '<div>before</div>' +
  SECTION +
  COLUMNS +
  LAYOUT_TABLE +
  CONTENT_TABLE +
  SPACER +
  SPACER +
  '<div>after</div>';

describe('layout lock — a static layout block keeps its structure', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: emailExtensions, content: PAGE });
    editor.focus();
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  const lock = () =>
    editor.commands['setLayoutInteraction']({
      section: false,
      columns: false,
      table: false,
      spacer: false,
      heading: false,
      list: false,
    });

  /** Where the `nth` node of `type` starts. */
  const posOf = (type: string, nth = 0): number => {
    let found = -1;
    let seen = 0;
    editor.state.doc.descendants((node, pos) => {
      if (found < 0 && node.type.name === type && seen++ === nth) found = pos;
      return found < 0;
    });
    return found;
  };
  const count = (type: string): number => {
    let total = 0;
    editor.state.doc.descendants((node: Node) => {
      if (node.type.name === type) total++;
    });
    return total;
  };
  /** The caret inside the first textblock of the `nth` node of `type`. */
  const caretIn = (type: string, nth = 0) =>
    editor.exec((state, dispatch) => {
      const $pos = state.doc.resolve(posOf(type, nth) + 1);
      dispatch?.(state.tr.setSelection(TextSelection.near($pos, 1)));
      return true;
    });
  const select = (type: string, nth = 0) =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(NodeSelection.create(state.doc, posOf(type, nth))));
      return true;
    });
  /** The whole node out, as a range (a selected table is its cells'
      selection, and deleting that empties them: words, not structure). */
  const remove = (type: string, nth = 0) =>
    editor.exec((state, dispatch) => {
      const pos = posOf(type, nth);
      dispatch?.(state.tr.delete(pos, pos + state.doc.nodeAt(pos)!.nodeSize));
      return true;
    });
  const deleteSelection = () =>
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.deleteSelection());
      return true;
    });

  it('unlocked, every block goes like any other', () => {
    select('spacer');
    deleteSelection();
    expect(count('spacer')).toBe(1);
    select('section');
    deleteSelection();
    expect(count('section')).toBe(0);
  });

  it('refuses to take a spacer, a band, a columns block or a layout table out', () => {
    lock();
    const html = editor.getHTML();
    for (const type of ['spacer', 'section', 'columns']) {
      select(type);
      deleteSelection();
    }
    // The layout table: the first table of the page.
    remove('table', 0);
    expect(editor.getHTML()).toBe(html);
  });

  it('refuses the second of two blocks alike, as much as the first', () => {
    lock();
    select('spacer', 1);
    deleteSelection();
    expect(count('spacer')).toBe(2);
  });

  it('refuses a selection across a band deleted, and the whole page', () => {
    lock();
    const html = editor.getHTML();
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.delete(1, posOf('columns') + 3));
      return true;
    });
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.delete(0, state.doc.content.size));
      return true;
    });
    expect(editor.getHTML()).toBe(html);
  });

  it('refuses a change of shape: a column added, a fill, a row, a height', () => {
    lock();
    const html = editor.getHTML();
    caretIn('column');
    editor.commands['addColumn']();
    editor.commands['setColumnBackground']('#e8f0fe');
    editor.commands['setColumnsGap'](16);
    caretIn('tableCell', 0);
    editor.commands['addRowAfter']();
    editor.exec((state, dispatch) => {
      const pos = posOf('spacer');
      dispatch?.(state.tr.setNodeMarkup(pos, null, { height: 80, background: null }));
      return true;
    });
    editor.exec((state, dispatch) => {
      const pos = posOf('section');
      const band = state.doc.nodeAt(pos)!;
      dispatch?.(state.tr.setNodeMarkup(pos, null, { ...band.attrs, background: '#fce8e6' }));
      return true;
    });
    expect(editor.getHTML()).toBe(html);
  });

  it('refuses a block moved', () => {
    lock();
    const html = editor.getHTML();
    editor.exec((state, dispatch) => {
      const pos = posOf('section');
      const band = state.doc.nodeAt(pos)!;
      dispatch?.(state.tr.delete(pos, pos + band.nodeSize).insert(0, band));
      return true;
    });
    expect(editor.getHTML()).toBe(html);
  });

  it('leaves the words free: in a band, a column, a cell, and round them', () => {
    lock();
    for (const [type, nth] of [
      ['section', 0],
      ['column', 1],
      ['tableCell', 0],
    ] as const) {
      caretIn(type, nth);
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.insertText('X'));
        return true;
      });
    }
    // A new line in a band, and the first line of the page gone.
    caretIn('section');
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.split(state.selection.from));
      return true;
    });
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.delete(1, 7));
      return true;
    });
    const html = editor.getHTML();
    expect(html).toContain('<div><br></div><div>Xband</div>');
    expect(html).toContain('<div>Xright</div>');
    expect(html).toContain('>Xone</td>');
    expect(html.startsWith('<div><br></div>')).toBe(true);
  });

  it('leaves a content table every change, beside a locked layout table', () => {
    lock();
    caretIn('table', 1);
    editor.commands['addRowAfter']();
    expect(editor.state.doc.nodeAt(posOf('table', 1))!.childCount).toBe(2);
    remove('table', 1);
    expect(count('table')).toBe(1);
  });

  it('lets a new block in', () => {
    lock();
    caretIn('paragraph', 0);
    editor.exec(insertHTML(SPACER));
    expect(count('spacer')).toBe(3);
  });

  it('passes an undo, a document set from outside, and a template loaded', () => {
    select('spacer');
    deleteSelection();
    lock();
    editor.commands['undo']();
    expect(count('spacer')).toBe(2);

    editor.exec(replaceHTML('<div>fresh</div>' + SPACER));
    expect(count('spacer')).toBe(1);
    expect(count('section')).toBe(0);

    editor.setContent('<div>synced</div>');
    expect(count('spacer')).toBe(0);
  });

  describe('text layout elements — frozen whole', () => {
    const HEADING =
      '<h2 class="aee-layout-heading" style="margin: 0px; font-size: 20px;">Title</h2>';
    const LIST =
      '<ul class="aee-layout-list" style="margin: 0px; padding-left: 24px;"><li><div>one</div></li><li><div>two</div></li></ul>';
    const SPACED = '<h3 style="margin: 14px 0px 4px; font-size: 18px;">Own</h3>';
    const TEXT = '<div>before</div>' + HEADING + LIST + SPACED + '<div>after</div>';

    beforeEach(() => editor.setContent(TEXT));

    const caretAt = (pos: number) =>
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, pos)));
        return true;
      });
    const range = (from: number, to: number) =>
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
        return true;
      });
    const type = (text: string) =>
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.insertText(text));
        return true;
      });

    it('takes no word, no mark, no other level, no item', () => {
      lock();
      const html = editor.getHTML();
      const heading = posOf('heading');
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.insertText('X', heading + 2));
        return true;
      });
      range(heading + 1, heading + 4);
      editor.commands['toggleBold']();
      editor.commands['setHeading'](3);
      editor.commands['setParagraph']();
      editor.commands['setAlignment']?.('center');
      const item = posOf('listItem');
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.insertText('X', item + 2));
        return true;
      });
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.delete(item, item + state.doc.nodeAt(item)!.nodeSize));
        return true;
      });
      range(item + 2, item + 3);
      editor.commands['toggleBulletList']();
      editor.commands['toggleOrderedList']();
      expect(editor.getHTML()).toBe(html);
    });

    it('says its commands cannot run there, so their buttons show disabled', () => {
      lock();
      const heading = posOf('heading');
      range(heading + 1, heading + 4);
      const can = (id: string) => {
        const action = editor.actions.find((entry) => entry.id === id)!;
        return action.command(editor.state);
      };
      expect(can('heading-1')).toBe(false);
      expect(can('text')).toBe(false);
      // In a line of the writer's own, they run.
      range(1, 4);
      expect(can('heading-1')).toBe(true);
    });

    it('holds no caret: one that lands there goes on, the way it was heading', () => {
      lock();
      const heading = posOf('heading');
      const list = posOf('bulletList');
      const end = list + editor.state.doc.nodeAt(list)!.nodeSize;
      // From above, into the heading: past the heading and the list, into
      // the spaced heading after them.
      caretAt(3);
      caretAt(heading + 2);
      expect(editor.state.selection.head).toBe(end + 1);
      // From below, into the list: back before both, to the first line's end.
      caretAt(end + 2);
      caretAt(list + 4);
      expect(editor.state.selection.head).toBe(heading - 1);
    });

    it('is marked for the browser and a stylesheet, only while frozen', () => {
      const frozen = () => host.querySelectorAll('.aee-static-text[contenteditable="false"]');
      expect(frozen().length).toBe(0);
      lock();
      expect(Array.from(frozen()).map((el) => el.tagName)).toEqual(['H2', 'UL']);
      editor.commands['setLayoutInteraction']({ heading: true, list: true });
      expect(frozen().length).toBe(0);
    });

    it("leaves a spaced heading the writer's own", () => {
      lock();
      const own = posOf('heading', 1);
      caretAt(own + 1);
      type('My ');
      editor.commands['setHeading'](2);
      expect(editor.getHTML()).toContain(
        '<h2 style="margin: 16px 0px 4px; font-size: 20px;">My Own</h2>',
      );
    });

    it('keeps its words when everything round it is deleted', () => {
      lock();
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.setSelection(new AllSelection(state.doc)));
        return true;
      });
      editor.view.someProp('handleKeyDown', (handle) =>
        handle(editor.view, new KeyboardEvent('keydown', { key: 'Delete' })),
      );
      expect(editor.state.doc.textContent).toBe('Titleonetwo');
    });

    it('unlocked, is text like any other', () => {
      const heading = posOf('heading');
      caretAt(heading + 1);
      type('A ');
      expect(editor.getHTML()).toContain('>A Title</h2>');
    });
  });

  describe('a selection across a static block', () => {
    const selectAll = () =>
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.setSelection(new AllSelection(state.doc)));
        return true;
      });
    const press = (key: string) =>
      editor.view.someProp('handleKeyDown', (handle) =>
        handle(editor.view, new KeyboardEvent('keydown', { key })),
      );
    const blocks = () =>
      ['section', 'columns', 'column', 'table', 'tableRow', 'tableCell', 'spacer'].map(count);

    it('Delete on everything empties the words and leaves every block', () => {
      lock();
      const before = blocks();
      selectAll();
      expect(press('Delete')).toBe(true);
      expect(blocks()).toEqual(before);
      expect(editor.state.doc.textContent).toBe('');
      // The caret, where the first words stood.
      expect(editor.state.selection.empty).toBe(true);
      expect(editor.state.selection.from).toBe(1);
    });

    it('Backspace from mid-line to mid-line keeps the rest of both lines', () => {
      lock();
      const before = blocks();
      editor.exec((state, dispatch) => {
        // "bef|ore" … into the columns: "le|ft".
        const to = posOf('column') + 2 + 2;
        dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, 4, to)));
        return true;
      });
      expect(press('Backspace')).toBe(true);
      expect(blocks()).toEqual(before);
      const html = editor.getHTML();
      expect(html.startsWith('<div>bef</div>')).toBe(true);
      expect(html).not.toContain('band');
      expect(html).toContain('<div>ft</div>');
      expect(html).toContain('<div>right</div>');
    });

    it('typing over it puts the text where the first words stood', () => {
      lock();
      selectAll();
      editor.view.someProp('handleTextInput', (handle) =>
        handle(editor.view, 0, editor.state.doc.content.size, 'Hi', () => editor.state.tr),
      );
      expect(editor.state.doc.textContent).toBe('Hi');
      expect(editor.getHTML().startsWith('<div>Hi</div>')).toBe(true);
      expect(count('section')).toBe(1);
    });

    it('selected blocks go whole, but for the static ones: those stay, emptied', () => {
      lock();
      const before = blocks();
      editor.exec((state, dispatch) => {
        dispatch?.(state.tr.setSelection(BlockSelection.all(state.doc)));
        return true;
      });
      expect(press('Backspace')).toBe(true);
      // The content table went with the lines; every layout block stands.
      expect(count('table')).toBe(1);
      expect(count('paragraph')).toBe(3);
      expect(blocks().filter((_, index) => index !== 3 && index !== 4 && index !== 5)).toEqual(
        before.filter((_, index) => index !== 3 && index !== 4 && index !== 5),
      );
      expect(editor.state.doc.textContent).toBe('');
      expect(editor.state.selection instanceof BlockSelection).toBe(false);
    });

    it('is one undo step', () => {
      lock();
      const html = editor.getHTML();
      selectAll();
      press('Delete');
      editor.commands['undo']();
      expect(editor.getHTML()).toBe(html);
    });

    it('unlocked, the lock answers no key', () => {
      selectAll();
      const before = editor.getHTML();
      // Whoever answers Delete here, it is not the lock: nothing of it
      // empties words and leaves the blocks.
      press('Delete');
      const after = editor.getHTML();
      expect(after === before || !after.includes('aee-layout-section')).toBe(true);
    });
  });

  it('is a lock by type: only what is switched off', () => {
    editor.commands['setLayoutInteraction']({ section: false });
    select('spacer');
    deleteSelection();
    expect(count('spacer')).toBe(1);
    select('section');
    deleteSelection();
    expect(count('section')).toBe(1);
  });
});
