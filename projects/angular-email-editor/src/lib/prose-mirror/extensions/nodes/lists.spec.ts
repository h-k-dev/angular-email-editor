import { TextSelection } from 'prosemirror-state';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { createEditor, Editor } from '../../editor';
import { emailExtensions } from '../kits';
import { BulletList, OrderedList, listStyle } from './lists';

const schema = createSchema(emailExtensions);
const roundTrip = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

const SPACED = 'margin: 12px 0px; padding-left: 24px;';
const FLUSH = 'margin: 0px; padding-left: 24px;';

describe('list spacing', () => {
  it('keeps 12px above and below; a layout list sits flush', () => {
    expect(listStyle()).toBe(SPACED);
    expect(listStyle(true)).toBe(FLUSH);
  });

  it('round-trips both kinds byte for byte, either flavour', () => {
    for (const style of [SPACED, FLUSH]) {
      const ul = `<ul style="${style}"><li><div>one</div></li></ul>`;
      const ol = `<ol start="3" style="${style}"><li><div>three</div></li></ol>`;
      expect(roundTrip(ul)).toBe(ul);
      expect(roundTrip(ol)).toBe(ol);
    }
  });

  it('reads a flush list — its top margin said, and zero — as layout; a bare one as spaced', () => {
    expect(roundTrip('<ul style="margin:0"><li><div>a</div></li></ul>')).toBe(
      `<ul style="${FLUSH}"><li><div>a</div></li></ul>`,
    );
    expect(roundTrip('<ul><li><div>a</div></li></ul>')).toBe(`<ul style="${SPACED}"><li><div>a</div></li></ul>`);
    expect(roundTrip('<ol style="margin-bottom: 0"><li><div>a</div></li></ol>')).toBe(
      `<ol style="${SPACED}"><li><div>a</div></li></ol>`,
    );
  });

  it('a nested list is always flush: it belongs to its item’s line', () => {
    expect(roundTrip('<ul><li><div>a</div><ol><li><div>b</div></li></ol></li></ul>')).toBe(
      `<ul style="${SPACED}"><li><div>a</div><ol style="${FLUSH}"><li><div>b</div></li></ol></li></ul>`,
    );
  });

  describe('in the editor', () => {
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

    const caretIn = (text: string) => {
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (at < 0 && node.isText && node.text === text) at = pos + 1;
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)),
      );
    };

    const run = (id: string) => {
      const actions = [
        ...BulletList.actions!({ schema: editor.schema, extensions: [] }),
        ...OrderedList.actions!({ schema: editor.schema, extensions: [] }),
      ];
      const action = actions.find((candidate) => candidate.id === id)!;
      return action.command!(editor.state, editor.view.dispatch, editor.view);
    };

    it('Tab nests a list flush, and the nesting is one undo step', () => {
      editor.setContent(`<ul style="${SPACED}"><li><div>a</div></li><li><div>b</div></li></ul>`);
      caretIn('b');
      editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, new KeyboardEvent('keydown', { key: 'Tab' })),
      );
      expect(editor.getHTML()).toBe(
        `<ul style="${SPACED}"><li><div>a</div><ul style="${FLUSH}"><li><div>b</div></li></ul></li></ul>`,
      );
      editor.commands['undo']();
      expect(editor.getHTML()).toBe(
        `<ul style="${SPACED}"><li><div>a</div></li><li><div>b</div></li></ul>`,
      );
    });

    it('the layout items wrap flush, make a spaced list flush, and lift a flush one out', () => {
      editor.setContent('<div>a</div>');
      caretIn('a');
      expect(run('bulleted-list-layout')).toBe(true);
      expect(editor.getHTML()).toBe(`<ul style="${FLUSH}"><li><div>a</div></li></ul>`);

      expect(run('bulleted-list-layout')).toBe(true);
      expect(editor.getHTML()).toBe('<div>a</div>');

      run('numbered-list');
      expect(editor.getHTML()).toBe(`<ol style="${SPACED}"><li><div>a</div></li></ol>`);
      run('numbered-list-layout');
      expect(editor.getHTML()).toBe(`<ol style="${FLUSH}"><li><div>a</div></li></ol>`);
    });

    it('a flavour change keeps a layout list flush', () => {
      editor.setContent(`<ul style="${FLUSH}"><li><div>a</div></li></ul>`);
      caretIn('a');
      editor.commands['toggleOrderedList']();
      expect(editor.getHTML()).toBe(`<ol style="${FLUSH}"><li><div>a</div></li></ol>`);
    });

    it('marks the right item active: spaced or layout', () => {
      const active = (id: string) =>
        [
          ...BulletList.actions!({ schema: editor.schema, extensions: [] }),
          ...OrderedList.actions!({ schema: editor.schema, extensions: [] }),
        ].find((candidate) => candidate.id === id)!.isActive!(editor.state);
      editor.setContent(`<ul style="${FLUSH}"><li><div>a</div></li></ul>`);
      caretIn('a');
      expect(active('bulleted-list-layout')).toBe(true);
      expect(active('bulleted-list')).toBe(false);
    });
  });
});
