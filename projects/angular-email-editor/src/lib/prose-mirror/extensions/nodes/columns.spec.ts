import { TextSelection } from 'prosemirror-state';
import { createEditor, Editor } from '../../editor';
import { createSchema } from '../../schema';
import { parseHTML, serializeToHTML } from '../../html';
import { lintHTML } from '../../html-source';
import { emailExtensions } from '../kits';
import { findColumnsContext } from './columns';

const schema = createSchema(emailExtensions);
const canonical = (html: string) => serializeToHTML(parseHTML(html, schema), schema);

const COL = (max: number) =>
  `display: inline-block; width: 100%; max-width: ${max}px; vertical-align: top; ` +
  `box-sizing: border-box; padding-left: 8px; padding-right: 8px;`;
const TWO_COLS =
  `<div style="width: 100%; max-width: 600px;">` +
  `<div style="${COL(300)}"><div>a</div></div>` +
  `<div style="${COL(300)}"><div>b</div></div></div>`;

describe('columns serialization', () => {
  it('is a round-trip fixpoint', () => {
    const once = canonical(TWO_COLS);
    expect(canonical(once)).toBe(once);
  });

  it('emits a fluid container and inline-block columns', () => {
    const html = canonical(TWO_COLS);
    expect(html).toContain('width: 100%; max-width: 600px;'); // container
    expect(html).toContain('display: inline-block');
    expect(html).toContain('max-width: 300px'); // 2 columns → 300 each
    expect(html).toContain('box-sizing: border-box');
    expect(html).toContain('<div>a</div>'); // column content, borderless div line
  });

  it('is lint-clean — max-width paired with width:100% is exempt', () => {
    expect(lintHTML(canonical(TWO_COLS))).toEqual([]);
  });
});

describe('columns editing', () => {
  let host: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = createEditor({ parent: host, extensions: emailExtensions, content: '<div>intro</div>' });
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
      return true;
    });
  });

  afterEach(() => {
    editor.destroy();
    host.remove();
  });

  it('insertColumns drops the cursor into the first column', () => {
    editor.commands['insertColumns'](2);
    expect(findColumnsContext(editor.state)).not.toBeNull();
    expect(editor.state.selection.$from.node(-1).type.name).toBe('column');
  });

  it('3 columns each get a third of the container width', () => {
    editor.commands['insertColumns'](3);
    expect(editor.getHTML()).toContain('max-width: 200px'); // 600 / 3
    // three inline-block columns
    expect((editor.getHTML().match(/display: inline-block/g) || []).length).toBe(3);
  });

  it('ArrowDown from the last column block escapes to a paragraph below', () => {
    editor.commands['insertColumns'](2); // columns is now the last block
    const escaped = editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'ArrowDown' })),
    );
    expect(escaped).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe('paragraph');
    editor.exec((state, dispatch) => {
      dispatch?.(state.tr.insertText('under'));
      return true;
    });
    expect(editor.getHTML()).toContain('</div><div>under</div>');
  });
});
